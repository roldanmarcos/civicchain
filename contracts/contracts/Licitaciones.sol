// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ICredencialNFT} from "./interfaces/ICredencialNFT.sol";

/// @title Licitaciones de obra pública de CivicChain
/// @notice Cada licitación es un NFT (ERC-721) cuyo tokenURI apunta a sus metadatos en IPFS.
///         El proceso tiene estas fases (ver el RFC):
///
///         1. Publicación   Un empleado estatal crea la licitación con dos fechas: el cierre de ofertas y la
///                          fecha límite de adjudicación.
///         2. Ofertas       Los proveedores ofertan de forma anónima: prueban con Semaphore que están en el
///                          grupo de habilitados y mandan dos cifrados con timelock (drand): el contenido de la
///                          oferta (para el cierre) y su identidad (para la fecha límite de adjudicación).
///                          El nullifier impide una segunda oferta de la misma empresa.
///         3. Apertura      Después del cierre, un empleado del organismo abre TODOS los sobres juntos, en una
///                          sola transacción. El ofertante no controla la apertura. Cualquiera puede verificar
///                          lo publicado: la clave de drand del cierre ya es pública.
///         4. Adjudicación  El empleado elige una oferta abierta, con dictamen, antes de la fecha límite.
///         5. Identidades   En la fecha límite drand libera la segunda clave y cualquiera (el bot del backend,
///                          un ciudadano) publica quién está detrás de cada oferta. El ganador puede revelarse
///                          antes por su cuenta para empezar la obra.
///         6. Ejecución     El organismo deposita el monto adjudicado (escrow). Cada etapa que aprueba un
///                          inspector del organismo se le paga sola al contratista.
///
/// @dev Las ofertas no las manda la wallet del proveedor sino el relayer (backend), para que ninguna
///      dirección identificable aparezca en la transacción. La autorización la da la prueba ZK.
contract Licitaciones is ERC721, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_ETAPAS = 20;
    uint256 public constant MAX_OFERTAS = 100;
    uint256 public constant MAX_TITULO = 160;
    /// @notice Tiempo mínimo entre el cierre y la fecha límite de adjudicación (para abrir y evaluar).
    ///         DUDA: en producción serían días o semanas; se deja corto para poder hacer la demo en clase.
    uint64 public constant MIN_EVALUACION = 5 minutes;
    /// @notice Escala ficticia para pagar en ETH montos expresados en pesos: 1 peso = 1 gwei.
    ///         Así una obra de $ 48.500.000 se deposita como 0,0485 ETH (se consigue en un faucet de Sepolia).
    ///         DUDA: en producción se pagaría con un token en pesos (stablecoin) en lugar de ETH.
    uint256 public constant WEI_POR_PESO = 1 gwei;

    enum Estado {
        RECIBIENDO_OFERTAS,
        APERTURA, // cerró el plazo: esperando que el organismo abra los sobres
        EVALUACION, // sobres abiertos: el organismo elige
        ADJUDICADA, // el ganador todavía no se conoce
        EN_EJECUCION,
        FINALIZADA,
        DESIERTA
    }

    struct Licitacion {
        uint32 organismoId;
        address creador;
        uint64 publicadaEn;
        uint64 cierreOfertas;
        uint64 limiteAdjudicacion; // también es cuando se revelan las identidades (ronda de drand)
        uint64 adjudicadaEn;
        uint256 presupuestoOficial; // pesos
        string titulo;
        string metadataCID; // JSON en IPFS: descripción, ubicación, nombres de etapas y CID del pliego
        uint16[] porcentajesEtapas; // en puntos básicos; suman 10.000
        bool sobresAbiertos;
        uint256 ofertaGanadora; // 0 = ninguna
        string dictamenCID;
        bool desierta;
        address contratista; // wallet del ganador, cuando se conoce
        uint8 etapasAprobadas;
        uint256 fondos; // wei depositados en escrow que todavía no se pagaron
        bool financiada;
    }

    struct Oferta {
        uint256 nullifier;
        bytes32 cifradoHash; // los cifrados completos van en el evento OfertaRecibida (ahorra gas)
        bytes32 cifradoIdentidadHash;
        bytes32 compromisoMonto; // keccak256(abi.encode(licitacionId, monto, plazoDias, desglose, sal))
        bytes32 compromisoAutoria; // keccak256(abi.encode(licitacionId, wallet, sal2))
        string propuestaCID; // propuesta técnica anonimizada en IPFS
        uint64 enviadaEn;
        bool abierta;
        bool descartada; // no se pudo descifrar en la apertura
        uint256 monto;
        uint32 plazoDias;
        address autor; // se completa cuando se revela la identidad
    }

    /// @notice Lo que manda el relayer para una oferta.
    struct OfertaNueva {
        bytes cifrado; // {monto, plazoDias, desglose, sal} cifrado para la ronda de drand del cierre
        bytes cifradoIdentidad; // {wallet, sal2} cifrado para la ronda de la fecha límite de adjudicación
        bytes32 compromisoMonto;
        bytes32 compromisoAutoria;
        string propuestaCID;
    }

    /// @notice Contenido descifrado de un sobre. `valido = false` si no se pudo descifrar (queda descartado).
    struct Sobre {
        bool valido;
        uint256 monto;
        uint32 plazoDias;
        uint256[] desglose;
        bytes32 sal;
    }

    /// @notice Identidad descifrada de una oferta.
    struct Identidad {
        uint256 ofertaId;
        address wallet;
        bytes32 sal;
    }

    ICredencialNFT public immutable credenciales;
    ISemaphore public immutable semaphore;
    uint256 public immutable grupoProveedores;

    uint256 private _proximoId = 1;
    mapping(uint256 licitacionId => Licitacion) private _licitaciones;
    mapping(uint256 licitacionId => Oferta[]) private _ofertas;
    mapping(uint256 licitacionId => mapping(uint256 ofertaId => uint256[])) private _desgloses;
    mapping(uint256 licitacionId => mapping(uint256 nullifier => bool)) private _nullifierUsado;
    mapping(uint256 licitacionId => address[]) private _inspectores;
    mapping(uint256 licitacionId => mapping(address => bool)) private _esInspector;

    event LicitacionPublicada(
        uint256 indexed licitacionId,
        uint32 indexed organismoId,
        address indexed creador,
        string titulo,
        string metadataCID,
        uint256 presupuestoOficial,
        uint64 cierreOfertas,
        uint64 limiteAdjudicacion
    );
    event OfertaRecibida(
        uint256 indexed licitacionId,
        uint256 indexed ofertaId,
        uint256 nullifier,
        bytes cifrado,
        bytes cifradoIdentidad,
        bytes32 compromisoMonto,
        bytes32 compromisoAutoria,
        string propuestaCID
    );
    event SobresAbiertos(uint256 indexed licitacionId, address indexed empleado, uint256 validas, uint256 descartadas);
    event OfertaAbierta(uint256 indexed licitacionId, uint256 indexed ofertaId, uint256 monto, uint32 plazoDias);
    event OfertaDescartada(uint256 indexed licitacionId, uint256 indexed ofertaId);
    event LicitacionAdjudicada(uint256 indexed licitacionId, uint256 indexed ofertaId, address indexed empleado, string dictamenCID);
    event LicitacionDesierta(uint256 indexed licitacionId, address indexed empleado, string dictamenCID);
    event AutoriaRevelada(uint256 indexed licitacionId, uint256 indexed ofertaId, address indexed proveedor, bool ganadora);
    event InspectorAsignado(uint256 indexed licitacionId, address indexed inspector);
    event FondosDepositados(uint256 indexed licitacionId, address indexed empleado, uint256 monto);
    event EvaluacionRegistrada(
        uint256 indexed licitacionId,
        uint256 indexed etapa,
        address indexed inspector,
        bool aprobada,
        string informeCID
    );
    event PagoRealizado(uint256 indexed licitacionId, uint256 indexed etapa, address indexed contratista, uint256 monto);

    error SinRol(ICredencialNFT.Rol rol);
    error OtroOrganismo();
    error LicitacionInexistente(uint256 licitacionId);
    error OfertaInexistente(uint256 ofertaId);
    error TextoInvalido();
    error FechaInvalida();
    error EtapasInvalidas();
    error PresupuestoInvalido();
    error FueraDePlazo(Estado estado);
    error PlazoDeAdjudicacionVencido();
    error IdentidadesTodaviaOcultas();
    error ScopeIncorrecto();
    error MensajeIncorrecto();
    error OfertaDuplicada();
    error DemasiadasOfertas();
    error PruebaInvalida();
    error SobresIncompletos();
    error CompromisoIncorrecto(uint256 ofertaId);
    error DesgloseInvalido(uint256 ofertaId);
    error OfertaNoAbierta();
    error SuperaPresupuesto();
    error AutoriaIncorrecta(uint256 ofertaId);
    error AutoriaYaRevelada();
    error InspectorYaAsignado();
    error NoEsInspectorAsignado();
    error EtapaIncorrecta();
    error SinContratista();
    error YaFinanciada();
    error MontoIncorrecto(uint256 esperado);
    error SinFondos();
    error PagoFallido();

    constructor(ICredencialNFT credenciales_) ERC721("CivicChain Licitacion", "CIVIC-LIC") {
        credenciales = credenciales_;
        semaphore = ISemaphore(credenciales_.semaphore());
        grupoProveedores = credenciales_.grupoProveedores();
    }

    // ---------------------------------------------------------------------
    // 1. Publicación
    // ---------------------------------------------------------------------

    /// @notice Publica una licitación. Solo empleados estatales con credencial vigente.
    /// @param cierreOfertas Hasta cuándo se reciben ofertas. Fija la ronda de drand de los montos.
    /// @param limiteAdjudicacion Hasta cuándo se puede adjudicar. Fija la ronda de drand de las identidades.
    /// @param porcentajesEtapas Porcentaje de cada etapa de la obra, en puntos básicos (suman 10.000).
    function crearLicitacion(
        string calldata titulo,
        string calldata metadataCID,
        uint256 presupuestoOficial,
        uint64 cierreOfertas,
        uint64 limiteAdjudicacion,
        uint16[] calldata porcentajesEtapas
    ) external returns (uint256 id) {
        uint32 organismo = _organismoDe(msg.sender, ICredencialNFT.Rol.EMPLEADO);
        if (bytes(titulo).length == 0 || bytes(titulo).length > MAX_TITULO) revert TextoInvalido();
        if (bytes(metadataCID).length == 0) revert TextoInvalido();
        if (presupuestoOficial == 0) revert PresupuestoInvalido();
        if (cierreOfertas <= block.timestamp || limiteAdjudicacion < cierreOfertas + MIN_EVALUACION) revert FechaInvalida();
        _validarEtapas(porcentajesEtapas);

        id = _proximoId++;
        Licitacion storage l = _licitaciones[id];
        l.organismoId = organismo;
        l.creador = msg.sender;
        l.publicadaEn = uint64(block.timestamp);
        l.cierreOfertas = cierreOfertas;
        l.limiteAdjudicacion = limiteAdjudicacion;
        l.presupuestoOficial = presupuestoOficial;
        l.titulo = titulo;
        l.metadataCID = metadataCID;
        l.porcentajesEtapas = porcentajesEtapas;

        // El NFT queda en custodia de este contrato: representa la licitación, no le pertenece a una persona.
        _mint(address(this), id);
        emit LicitacionPublicada(id, organismo, msg.sender, titulo, metadataCID, presupuestoOficial, cierreOfertas, limiteAdjudicacion);
    }

    // ---------------------------------------------------------------------
    // 2. Ofertas anónimas
    // ---------------------------------------------------------------------

    /// @notice Mensaje que tiene que firmar la prueba de Semaphore. Ata la prueba a esta oferta:
    ///         si alguien cambia un cifrado o un compromiso, la prueba deja de valer.
    function mensajeOferta(
        uint256 licitacionId,
        bytes32 cifradoHash,
        bytes32 cifradoIdentidadHash,
        bytes32 compromisoMonto,
        bytes32 compromisoAutoria,
        string memory propuestaCID
    ) public pure returns (uint256) {
        return uint256(
            keccak256(abi.encode(licitacionId, cifradoHash, cifradoIdentidadHash, compromisoMonto, compromisoAutoria, propuestaCID))
        );
    }

    /// @notice Recibe una oferta anónima. La puede mandar cualquiera (en la práctica, el relayer).
    /// @param prueba Prueba de Semaphore con scope = licitacionId y message = mensajeOferta(...).
    function ofertar(
        uint256 licitacionId,
        OfertaNueva calldata o,
        ISemaphore.SemaphoreProof calldata prueba
    ) external returns (uint256 ofertaId) {
        _exigirEstado(licitacionId, Estado.RECIBIENDO_OFERTAS);
        if (o.cifrado.length == 0 || o.cifradoIdentidad.length == 0 || o.compromisoMonto == 0 || o.compromisoAutoria == 0) {
            revert TextoInvalido();
        }
        if (_ofertas[licitacionId].length >= MAX_OFERTAS) revert DemasiadasOfertas();

        // El scope de la prueba es la licitación: así el nullifier es único por empresa y por licitación.
        if (prueba.scope != licitacionId) revert ScopeIncorrecto();
        bytes32 cifradoHash = keccak256(o.cifrado);
        bytes32 cifradoIdentidadHash = keccak256(o.cifradoIdentidad);
        if (
            prueba.message !=
            mensajeOferta(licitacionId, cifradoHash, cifradoIdentidadHash, o.compromisoMonto, o.compromisoAutoria, o.propuestaCID)
        ) revert MensajeIncorrecto();
        if (_nullifierUsado[licitacionId][prueba.nullifier]) revert OfertaDuplicada();
        // Se usa verifyProof (solo lectura) y los nullifiers se guardan acá: `validateProof` de Semaphore
        // lo puede llamar cualquiera, y alguien podría "quemar" el nullifier antes que nosotros.
        if (!semaphore.verifyProof(grupoProveedores, prueba)) revert PruebaInvalida();
        _nullifierUsado[licitacionId][prueba.nullifier] = true;

        Oferta storage nueva = _ofertas[licitacionId].push();
        nueva.nullifier = prueba.nullifier;
        nueva.cifradoHash = cifradoHash;
        nueva.cifradoIdentidadHash = cifradoIdentidadHash;
        nueva.compromisoMonto = o.compromisoMonto;
        nueva.compromisoAutoria = o.compromisoAutoria;
        nueva.propuestaCID = o.propuestaCID;
        nueva.enviadaEn = uint64(block.timestamp);
        ofertaId = _ofertas[licitacionId].length;
        emit OfertaRecibida(
            licitacionId,
            ofertaId,
            prueba.nullifier,
            o.cifrado,
            o.cifradoIdentidad,
            o.compromisoMonto,
            o.compromisoAutoria,
            o.propuestaCID
        );
    }

    // ---------------------------------------------------------------------
    // 3. Apertura de sobres (todos juntos, por el organismo)
    // ---------------------------------------------------------------------

    /// @notice Un empleado del organismo publica el contenido de TODAS las ofertas en una sola transacción.
    /// @dev El empleado descifra en su navegador (la clave de drand del cierre ya es pública) y manda un
    ///      sobre por oferta, en orden. Las que no se pudieron descifrar van con `valido = false` y quedan
    ///      descartadas. El ofertante no participa: aunque sepa los valores de su oferta, no puede abrirla él.
    ///      Control: cualquiera puede descifrar los cifrados (están en los eventos) y comprobar que lo
    ///      publicado coincide; la dApp tiene un botón "Verificar apertura". Si el empleado descartara una
    ///      oferta válida, quedaría a la vista.
    ///      DUDA: el contrato no puede comprobar por sí mismo que una oferta descartada era indescifrable
    ///      (exigiría verificar el descifrado en la cadena). ¿Hace falta un mecanismo de impugnación?
    function abrirSobres(uint256 licitacionId, Sobre[] calldata sobres) external {
        _exigirEstado(licitacionId, Estado.APERTURA);
        Licitacion storage l = _licitaciones[licitacionId];
        _exigirEmpleadoDe(l.organismoId);
        if (block.timestamp > l.limiteAdjudicacion) revert PlazoDeAdjudicacionVencido();
        Oferta[] storage ofertas = _ofertas[licitacionId];
        if (sobres.length != ofertas.length) revert SobresIncompletos();

        uint256 validas;
        for (uint256 i; i < sobres.length; i++) {
            uint256 ofertaId = i + 1;
            if (!sobres[i].valido) {
                ofertas[i].descartada = true;
                emit OfertaDescartada(licitacionId, ofertaId);
                continue;
            }
            _abrir(licitacionId, ofertaId, ofertas[i], sobres[i], l.porcentajesEtapas.length);
            validas++;
        }
        l.sobresAbiertos = true;
        emit SobresAbiertos(licitacionId, msg.sender, validas, sobres.length - validas);
    }

    function _abrir(uint256 licitacionId, uint256 ofertaId, Oferta storage o, Sobre calldata s, uint256 etapas) private {
        if (keccak256(abi.encode(licitacionId, s.monto, s.plazoDias, s.desglose, s.sal)) != o.compromisoMonto) {
            revert CompromisoIncorrecto(ofertaId);
        }
        if (s.desglose.length != etapas) revert DesgloseInvalido(ofertaId);
        uint256 suma;
        for (uint256 j; j < s.desglose.length; j++) suma += s.desglose[j];
        if (suma != s.monto || s.monto == 0 || s.plazoDias == 0) revert DesgloseInvalido(ofertaId);

        o.abierta = true;
        o.monto = s.monto;
        o.plazoDias = s.plazoDias;
        _desgloses[licitacionId][ofertaId] = s.desglose;
        emit OfertaAbierta(licitacionId, ofertaId, s.monto, s.plazoDias);
    }

    // ---------------------------------------------------------------------
    // 4. Adjudicación
    // ---------------------------------------------------------------------

    /// @notice Un empleado del organismo adjudica una oferta abierta, con dictamen, antes de la fecha límite.
    /// @dev No tiene por qué ser la más baja (RFC: la elección es discrecional), pero no puede superar
    ///      el presupuesto oficial.
    function adjudicar(uint256 licitacionId, uint256 ofertaId, string calldata dictamenCID) external {
        _exigirEstado(licitacionId, Estado.EVALUACION);
        Licitacion storage l = _licitaciones[licitacionId];
        _exigirEmpleadoDe(l.organismoId);
        // Después de la fecha límite las identidades ya se pueden conocer: adjudicar dejaría de ser a ciegas.
        if (block.timestamp > l.limiteAdjudicacion) revert PlazoDeAdjudicacionVencido();
        if (bytes(dictamenCID).length == 0) revert TextoInvalido();
        Oferta storage o = _oferta(licitacionId, ofertaId);
        if (!o.abierta) revert OfertaNoAbierta();
        if (o.monto > l.presupuestoOficial) revert SuperaPresupuesto();

        l.ofertaGanadora = ofertaId;
        l.dictamenCID = dictamenCID;
        l.adjudicadaEn = uint64(block.timestamp);
        emit LicitacionAdjudicada(licitacionId, ofertaId, msg.sender, dictamenCID);
    }

    /// @notice Declara desierta la licitación (sin ofertas válidas, ninguna conveniente, o venció el plazo).
    function declararDesierta(uint256 licitacionId, string calldata dictamenCID) external {
        Estado e = estado(licitacionId);
        if (e != Estado.APERTURA && e != Estado.EVALUACION) revert FueraDePlazo(e);
        Licitacion storage l = _licitaciones[licitacionId];
        _exigirEmpleadoDe(l.organismoId);
        if (bytes(dictamenCID).length == 0) revert TextoInvalido();
        l.desierta = true;
        l.dictamenCID = dictamenCID;
        emit LicitacionDesierta(licitacionId, msg.sender, dictamenCID);
    }

    // ---------------------------------------------------------------------
    // 5. Identidades
    // ---------------------------------------------------------------------

    /// @notice Publica las identidades descifradas. Lo puede llamar cualquiera después de la fecha límite
    ///         de adjudicación (cuando drand libera la clave). En la práctica lo hace el bot del backend.
    /// @dev Las identidades que ya estaban reveladas se saltean, así se puede llamar varias veces.
    ///      Si una identidad no se puede descifrar (el ofertante cifró basura), esa oferta queda sin autor:
    ///      si era la ganadora, no hay contratista y el organismo tendrá que relicitar.
    function revelarIdentidades(uint256 licitacionId, Identidad[] calldata identidades) external {
        Licitacion storage l = _licitacion(licitacionId);
        if (block.timestamp <= l.limiteAdjudicacion) revert IdentidadesTodaviaOcultas();
        for (uint256 i; i < identidades.length; i++) {
            Identidad calldata id = identidades[i];
            Oferta storage o = _oferta(licitacionId, id.ofertaId);
            if (o.autor != address(0)) continue;
            if (keccak256(abi.encode(licitacionId, id.wallet, id.sal)) != o.compromisoAutoria) revert AutoriaIncorrecta(id.ofertaId);
            _registrarAutor(licitacionId, l, id.ofertaId, o, id.wallet);
        }
    }

    /// @notice El proveedor revela por su cuenta, desde su wallet real, que es autor de una oferta.
    /// @dev Opcional: sirve para que el ganador arranque la obra sin esperar la fecha límite. Solo
    ///      después de adjudicar (o declarar desierta), así la identidad no influye en la elección.
    ///      LIMITACIÓN: dos proveedores habilitados que se pongan de acuerdo podrían "prestarse" la
    ///      autoría (A oferta poniendo la wallet de B en el compromiso). Evitarlo sin romper el
    ///      anonimato requiere otra prueba ZK al revelar.
    function revelarAutoria(uint256 licitacionId, uint256 ofertaId, bytes32 sal) external {
        Licitacion storage l = _licitacion(licitacionId);
        if (l.ofertaGanadora == 0 && !l.desierta) revert FueraDePlazo(estado(licitacionId));
        Oferta storage o = _oferta(licitacionId, ofertaId);
        if (o.autor != address(0)) revert AutoriaYaRevelada();
        if (keccak256(abi.encode(licitacionId, msg.sender, sal)) != o.compromisoAutoria) revert AutoriaIncorrecta(ofertaId);
        _registrarAutor(licitacionId, l, ofertaId, o, msg.sender);
    }

    function _registrarAutor(uint256 licitacionId, Licitacion storage l, uint256 ofertaId, Oferta storage o, address wallet) private {
        o.autor = wallet;
        bool ganadora = ofertaId == l.ofertaGanadora;
        if (ganadora) l.contratista = wallet;
        emit AutoriaRevelada(licitacionId, ofertaId, wallet, ganadora);
    }

    // ---------------------------------------------------------------------
    // 6. Ejecución: fondos, inspectores, etapas y pagos
    // ---------------------------------------------------------------------

    /// @notice El organismo deposita el monto adjudicado (en ETH, a WEI_POR_PESO por peso). Queda en el
    ///         contrato y se le paga al contratista etapa por etapa.
    function depositarFondos(uint256 licitacionId) external payable {
        Licitacion storage l = _licitacion(licitacionId);
        if (l.ofertaGanadora == 0) revert FueraDePlazo(estado(licitacionId));
        _exigirEmpleadoDe(l.organismoId);
        if (l.financiada) revert YaFinanciada();
        uint256 esperado = montoAdjudicadoEnWei(licitacionId);
        if (msg.value != esperado) revert MontoIncorrecto(esperado);
        l.financiada = true;
        l.fondos = msg.value;
        emit FondosDepositados(licitacionId, msg.sender, msg.value);
    }

    /// @notice Un empleado del organismo asigna un inspector del mismo organismo a la obra.
    function asignarInspector(uint256 licitacionId, address inspector) external {
        Licitacion storage l = _licitacion(licitacionId);
        _exigirEmpleadoDe(l.organismoId);
        if (_organismoDe(inspector, ICredencialNFT.Rol.INSPECTOR) != l.organismoId) revert OtroOrganismo();
        if (_esInspector[licitacionId][inspector]) revert InspectorYaAsignado();
        _esInspector[licitacionId][inspector] = true;
        _inspectores[licitacionId].push(inspector);
        emit InspectorAsignado(licitacionId, inspector);
    }

    /// @notice El inspector registra su evaluación de la siguiente etapa pendiente. Si la aprueba, el
    ///         contrato le paga al contratista lo que cotizó para esa etapa (desglose de su oferta).
    /// @dev Si no la aprueba, queda registrada la observación y la etapa sigue pendiente (no se paga).
    function registrarEvaluacion(
        uint256 licitacionId,
        uint256 etapa,
        bool aprobada,
        string calldata informeCID
    ) external nonReentrant {
        Licitacion storage l = _licitacion(licitacionId);
        if (!_esInspector[licitacionId][msg.sender]) revert NoEsInspectorAsignado();
        if (!credenciales.tieneRolActivo(msg.sender, ICredencialNFT.Rol.INSPECTOR)) revert SinRol(ICredencialNFT.Rol.INSPECTOR);
        if (l.contratista == address(0)) revert SinContratista();
        if (!l.financiada) revert SinFondos();
        if (etapa != l.etapasAprobadas || etapa >= l.porcentajesEtapas.length) revert EtapaIncorrecta();
        if (bytes(informeCID).length == 0) revert TextoInvalido();

        emit EvaluacionRegistrada(licitacionId, etapa, msg.sender, aprobada, informeCID);
        if (!aprobada) return;

        l.etapasAprobadas++;
        uint256 pago = _desgloses[licitacionId][l.ofertaGanadora][etapa] * WEI_POR_PESO;
        l.fondos -= pago;
        // DUDA: si la wallet del contratista fuera un contrato que rechaza ETH, la evaluación no se podría
        // registrar. Con wallets comunes no pasa; la alternativa es que el contratista retire (pull).
        (bool ok, ) = l.contratista.call{value: pago}("");
        if (!ok) revert PagoFallido();
        emit PagoRealizado(licitacionId, etapa, l.contratista, pago);
    }

    // ---------------------------------------------------------------------
    // Consultas
    // ---------------------------------------------------------------------

    function estado(uint256 licitacionId) public view returns (Estado) {
        Licitacion storage l = _licitacion(licitacionId);
        if (l.desierta) return Estado.DESIERTA;
        if (l.ofertaGanadora != 0) {
            if (l.contratista == address(0)) return Estado.ADJUDICADA;
            if (l.etapasAprobadas == l.porcentajesEtapas.length) return Estado.FINALIZADA;
            return Estado.EN_EJECUCION;
        }
        if (block.timestamp <= l.cierreOfertas) return Estado.RECIBIENDO_OFERTAS;
        if (!l.sobresAbiertos) return Estado.APERTURA;
        return Estado.EVALUACION;
    }

    /// @notice Monto adjudicado expresado en wei (lo que hay que depositar).
    function montoAdjudicadoEnWei(uint256 licitacionId) public view returns (uint256) {
        Licitacion storage l = _licitacion(licitacionId);
        if (l.ofertaGanadora == 0) return 0;
        return _ofertas[licitacionId][l.ofertaGanadora - 1].monto * WEI_POR_PESO;
    }

    function licitacion(uint256 licitacionId) external view returns (Licitacion memory) {
        return _licitacion(licitacionId);
    }

    function oferta(uint256 licitacionId, uint256 ofertaId) external view returns (Oferta memory) {
        return _oferta(licitacionId, ofertaId);
    }

    function cantidadOfertas(uint256 licitacionId) external view returns (uint256) {
        return _ofertas[licitacionId].length;
    }

    function desgloseDe(uint256 licitacionId, uint256 ofertaId) external view returns (uint256[] memory) {
        return _desgloses[licitacionId][ofertaId];
    }

    function inspectores(uint256 licitacionId) external view returns (address[] memory) {
        return _inspectores[licitacionId];
    }

    function nullifierUsado(uint256 licitacionId, uint256 nullifier) external view returns (bool) {
        return _nullifierUsado[licitacionId][nullifier];
    }

    function totalLicitaciones() external view returns (uint256) {
        return _proximoId - 1;
    }

    function tokenURI(uint256 licitacionId) public view override returns (string memory) {
        _requireOwned(licitacionId);
        return string.concat("ipfs://", _licitaciones[licitacionId].metadataCID);
    }

    // ---------------------------------------------------------------------
    // Internas
    // ---------------------------------------------------------------------

    function _licitacion(uint256 licitacionId) private view returns (Licitacion storage l) {
        if (licitacionId == 0 || licitacionId >= _proximoId) revert LicitacionInexistente(licitacionId);
        return _licitaciones[licitacionId];
    }

    function _oferta(uint256 licitacionId, uint256 ofertaId) private view returns (Oferta storage) {
        Oferta[] storage lista = _ofertas[licitacionId];
        if (ofertaId == 0 || ofertaId > lista.length) revert OfertaInexistente(ofertaId);
        return lista[ofertaId - 1];
    }

    function _exigirEstado(uint256 licitacionId, Estado esperado) private view {
        Estado actual = estado(licitacionId);
        if (actual != esperado) revert FueraDePlazo(actual);
    }

    function _organismoDe(address wallet, ICredencialNFT.Rol rol) private view returns (uint32) {
        if (!credenciales.tieneRolActivo(wallet, rol)) revert SinRol(rol);
        return credenciales.organismoDe(wallet, rol);
    }

    function _exigirEmpleadoDe(uint32 organismoId) private view {
        if (_organismoDe(msg.sender, ICredencialNFT.Rol.EMPLEADO) != organismoId) revert OtroOrganismo();
    }

    function _validarEtapas(uint16[] calldata porcentajes) private pure {
        if (porcentajes.length == 0 || porcentajes.length > MAX_ETAPAS) revert EtapasInvalidas();
        uint256 suma;
        for (uint256 i; i < porcentajes.length; i++) {
            if (porcentajes[i] == 0) revert EtapasInvalidas();
            suma += porcentajes[i];
        }
        if (suma != BPS) revert EtapasInvalidas();
    }
}
