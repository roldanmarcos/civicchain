// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ICredencialNFT} from "./interfaces/ICredencialNFT.sol";

/// @title Licitaciones de obra pública de CivicChain
/// @notice Cada licitación es un NFT (ERC-721) cuyo tokenURI apunta a sus metadatos en IPFS.
///         El proceso tiene estas fases (ver el RFC):
///
///         1. Publicación   Un empleado estatal crea la licitación.
///         2. Ofertas       Los proveedores ofertan de forma anónima: prueban con Semaphore que están
///                          en el grupo de habilitados y mandan el monto cifrado con timelock (drand).
///                          El nullifier impide una segunda oferta de la misma empresa.
///         3. Apertura      Al vencer el plazo, cualquiera descifra los montos (la clave de drand ya es
///                          pública) y los publica con `abrirOferta`; el contrato verifica el compromiso.
///         4. Adjudicación  Un empleado del organismo elige una oferta abierta y publica su dictamen.
///         5. Cierre        Ganador y perdedores revelan qué wallet está detrás de cada oferta.
///         6. Ejecución     Los inspectores asignados aprueban las etapas de la obra en orden.
///
/// @dev Las ofertas no las manda la wallet del proveedor sino el relayer (backend), para que ninguna
///      dirección identificable aparezca en la transacción. El contrato no confía en el relayer:
///      la autorización la da la prueba de conocimiento cero.
contract Licitaciones is ERC721 {
    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_ETAPAS = 20;
    uint256 public constant MAX_OFERTAS = 200;
    uint256 public constant MAX_TITULO = 160;
    /// @notice Duración mínima de la ventana de apertura. DUDA: en producción convendría algo más
    ///         largo (días); se deja corto para poder hacer la demo en una clase.
    uint64 public constant MIN_APERTURA = 5 minutes;

    enum Estado {
        RECIBIENDO_OFERTAS,
        APERTURA,
        EVALUACION,
        ADJUDICADA,
        EN_EJECUCION,
        FINALIZADA,
        DESIERTA
    }

    struct Licitacion {
        uint32 organismoId;
        address creador;
        uint64 publicadaEn;
        uint64 cierreOfertas;
        uint64 finApertura;
        uint64 adjudicadaEn;
        uint256 presupuestoOficial; // pesos
        string titulo;
        string metadataCID; // JSON en IPFS: descripción, ubicación, nombres de etapas y CID del pliego
        uint16[] porcentajesEtapas; // en puntos básicos; suman 10.000
        uint256 ofertaGanadora; // 0 = ninguna
        string dictamenCID;
        bool desierta;
        address contratista; // wallet del ganador, cuando revela su identidad
        uint8 etapasAprobadas;
    }

    struct Oferta {
        uint256 nullifier;
        bytes32 cifradoHash; // el cifrado completo va en el evento OfertaRecibida (ahorra gas)
        bytes32 compromisoMonto; // keccak256(abi.encode(licitacionId, monto, plazoDias, desglose, sal))
        bytes32 compromisoAutoria; // keccak256(abi.encode(licitacionId, wallet, sal2))
        string propuestaCID; // propuesta técnica anonimizada en IPFS
        uint64 enviadaEn;
        bool abierta;
        uint256 monto;
        uint32 plazoDias;
        address autor; // se completa cuando el proveedor revela
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
        uint64 finApertura
    );
    event OfertaRecibida(
        uint256 indexed licitacionId,
        uint256 indexed ofertaId,
        uint256 nullifier,
        bytes cifrado,
        bytes32 compromisoMonto,
        bytes32 compromisoAutoria,
        string propuestaCID
    );
    event OfertaAbierta(uint256 indexed licitacionId, uint256 indexed ofertaId, uint256 monto, uint32 plazoDias);
    event LicitacionAdjudicada(uint256 indexed licitacionId, uint256 indexed ofertaId, address indexed empleado, string dictamenCID);
    event LicitacionDesierta(uint256 indexed licitacionId, address indexed empleado, string dictamenCID);
    event AutoriaRevelada(uint256 indexed licitacionId, uint256 indexed ofertaId, address indexed proveedor, bool ganadora);
    event InspectorAsignado(uint256 indexed licitacionId, address indexed inspector);
    event EvaluacionRegistrada(
        uint256 indexed licitacionId,
        uint256 indexed etapa,
        address indexed inspector,
        bool aprobada,
        string informeCID
    );

    error SinRol(ICredencialNFT.Rol rol);
    error OtroOrganismo();
    error LicitacionInexistente(uint256 licitacionId);
    error OfertaInexistente(uint256 ofertaId);
    error TextoInvalido();
    error FechaInvalida();
    error EtapasInvalidas();
    error PresupuestoInvalido();
    error FueraDePlazo(Estado estado);
    error PruebaInvalida();
    error ScopeIncorrecto();
    error MensajeIncorrecto();
    error OfertaDuplicada();
    error DemasiadasOfertas();
    error OfertaYaAbierta();
    error CompromisoIncorrecto();
    error DesgloseInvalido();
    error OfertaNoAbierta();
    error SuperaPresupuesto();
    error AutoriaIncorrecta();
    error AutoriaYaRevelada();
    error InspectorYaAsignado();
    error NoEsInspectorAsignado();
    error EtapaIncorrecta();
    error SinContratista();

    constructor(ICredencialNFT credenciales_) ERC721("CivicChain Licitacion", "CIVIC-LIC") {
        credenciales = credenciales_;
        semaphore = ISemaphore(credenciales_.semaphore());
        grupoProveedores = credenciales_.grupoProveedores();
    }

    // ---------------------------------------------------------------------
    // 1. Publicación
    // ---------------------------------------------------------------------

    /// @notice Publica una licitación. Solo empleados estatales con credencial vigente.
    /// @param cierreOfertas Hasta cuándo se reciben ofertas. También fija la ronda de drand para la que
    ///        se cifran los montos.
    /// @param duracionApertura Cuánto dura la ventana para publicar los montos descifrados.
    /// @param porcentajesEtapas Porcentaje de cada etapa de la obra, en puntos básicos (suman 10.000).
    function crearLicitacion(
        string calldata titulo,
        string calldata metadataCID,
        uint256 presupuestoOficial,
        uint64 cierreOfertas,
        uint64 duracionApertura,
        uint16[] calldata porcentajesEtapas
    ) external returns (uint256 id) {
        uint32 organismo = _organismoDe(msg.sender, ICredencialNFT.Rol.EMPLEADO);
        if (bytes(titulo).length == 0 || bytes(titulo).length > MAX_TITULO) revert TextoInvalido();
        if (bytes(metadataCID).length == 0) revert TextoInvalido();
        if (presupuestoOficial == 0) revert PresupuestoInvalido();
        if (cierreOfertas <= block.timestamp || duracionApertura < MIN_APERTURA) revert FechaInvalida();
        _validarEtapas(porcentajesEtapas);

        id = _proximoId++;
        Licitacion storage l = _licitaciones[id];
        l.organismoId = organismo;
        l.creador = msg.sender;
        l.publicadaEn = uint64(block.timestamp);
        l.cierreOfertas = cierreOfertas;
        l.finApertura = cierreOfertas + duracionApertura;
        l.presupuestoOficial = presupuestoOficial;
        l.titulo = titulo;
        l.metadataCID = metadataCID;
        l.porcentajesEtapas = porcentajesEtapas;

        // El NFT queda en custodia de este contrato: representa la licitación, no le pertenece a una persona.
        _mint(address(this), id);
        emit LicitacionPublicada(id, organismo, msg.sender, titulo, metadataCID, presupuestoOficial, cierreOfertas, l.finApertura);
    }

    // ---------------------------------------------------------------------
    // 2. Ofertas anónimas
    // ---------------------------------------------------------------------

    /// @notice Mensaje que tiene que firmar la prueba de Semaphore. Ata la prueba a esta oferta:
    ///         si alguien cambia el cifrado o los compromisos, la prueba deja de valer.
    function mensajeOferta(
        uint256 licitacionId,
        bytes32 cifradoHash,
        bytes32 compromisoMonto,
        bytes32 compromisoAutoria,
        string memory propuestaCID
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(licitacionId, cifradoHash, compromisoMonto, compromisoAutoria, propuestaCID)));
    }

    /// @notice Recibe una oferta anónima. La puede mandar cualquiera (en la práctica, el relayer).
    /// @param cifrado Monto, plazo, desglose y sal, cifrados con tlock para la ronda de drand del cierre.
    /// @param prueba Prueba de Semaphore con scope = licitacionId y message = mensajeOferta(...).
    function ofertar(
        uint256 licitacionId,
        bytes calldata cifrado,
        bytes32 compromisoMonto,
        bytes32 compromisoAutoria,
        string calldata propuestaCID,
        ISemaphore.SemaphoreProof calldata prueba
    ) external returns (uint256 ofertaId) {
        _exigirEstado(licitacionId, Estado.RECIBIENDO_OFERTAS);
        if (cifrado.length == 0 || compromisoMonto == 0 || compromisoAutoria == 0) revert TextoInvalido();
        if (_ofertas[licitacionId].length >= MAX_OFERTAS) revert DemasiadasOfertas();

        // El scope de la prueba es la licitación: así el nullifier es único por empresa y por licitación.
        if (prueba.scope != licitacionId) revert ScopeIncorrecto();
        bytes32 cifradoHash = keccak256(cifrado);
        if (prueba.message != mensajeOferta(licitacionId, cifradoHash, compromisoMonto, compromisoAutoria, propuestaCID)) {
            revert MensajeIncorrecto();
        }
        if (_nullifierUsado[licitacionId][prueba.nullifier]) revert OfertaDuplicada();
        // Se usa verifyProof (solo lectura) y los nullifiers se guardan acá: `validateProof` de Semaphore
        // lo puede llamar cualquiera, y alguien podría "quemar" el nullifier antes que nosotros.
        if (!semaphore.verifyProof(grupoProveedores, prueba)) revert PruebaInvalida();
        _nullifierUsado[licitacionId][prueba.nullifier] = true;

        _ofertas[licitacionId].push(
            Oferta({
                nullifier: prueba.nullifier,
                cifradoHash: cifradoHash,
                compromisoMonto: compromisoMonto,
                compromisoAutoria: compromisoAutoria,
                propuestaCID: propuestaCID,
                enviadaEn: uint64(block.timestamp),
                abierta: false,
                monto: 0,
                plazoDias: 0,
                autor: address(0)
            })
        );
        ofertaId = _ofertas[licitacionId].length;
        emit OfertaRecibida(licitacionId, ofertaId, prueba.nullifier, cifrado, compromisoMonto, compromisoAutoria, propuestaCID);
    }

    // ---------------------------------------------------------------------
    // 3. Apertura
    // ---------------------------------------------------------------------

    /// @notice Publica el contenido descifrado de una oferta. Lo puede llamar cualquiera después del cierre.
    /// @dev El contrato no puede comprobar que el cifrado contenga estos valores (eso exigiría una prueba
    ///      ZK de cifrado correcto); verifica el compromiso. Las ofertas que nadie logra abrir dentro de la
    ///      ventana quedan descartadas.
    ///      LIMITACIÓN: una empresa podría cifrar basura y guardarse los valores reales para abrirla ella
    ///      misma solo si le conviene (como en un commit-reveal). Mitigaciones posibles: exigir una garantía
    ///      que se pierde si la oferta no se abre, o una prueba ZK de que el cifrado es correcto.
    function abrirOferta(
        uint256 licitacionId,
        uint256 ofertaId,
        uint256 monto,
        uint32 plazoDias,
        uint256[] calldata desglose,
        bytes32 sal
    ) external {
        _exigirEstado(licitacionId, Estado.APERTURA);
        Oferta storage o = _oferta(licitacionId, ofertaId);
        if (o.abierta) revert OfertaYaAbierta();
        if (keccak256(abi.encode(licitacionId, monto, plazoDias, desglose, sal)) != o.compromisoMonto) {
            revert CompromisoIncorrecto();
        }
        if (desglose.length != _licitaciones[licitacionId].porcentajesEtapas.length) revert DesgloseInvalido();
        uint256 suma;
        for (uint256 i; i < desglose.length; i++) suma += desglose[i];
        if (suma != monto || monto == 0 || plazoDias == 0) revert DesgloseInvalido();

        o.abierta = true;
        o.monto = monto;
        o.plazoDias = plazoDias;
        _desgloses[licitacionId][ofertaId] = desglose;
        emit OfertaAbierta(licitacionId, ofertaId, monto, plazoDias);
    }

    // ---------------------------------------------------------------------
    // 4. Adjudicación
    // ---------------------------------------------------------------------

    /// @notice Un empleado del organismo adjudica una oferta abierta y publica su dictamen fundado.
    /// @dev No tiene por qué ser la más baja (RFC: la elección es discrecional), pero no puede superar
    ///      el presupuesto oficial.
    function adjudicar(uint256 licitacionId, uint256 ofertaId, string calldata dictamenCID) external {
        _exigirEstado(licitacionId, Estado.EVALUACION);
        Licitacion storage l = _licitaciones[licitacionId];
        _exigirEmpleadoDe(l.organismoId);
        if (bytes(dictamenCID).length == 0) revert TextoInvalido();
        Oferta storage o = _oferta(licitacionId, ofertaId);
        if (!o.abierta) revert OfertaNoAbierta();
        if (o.monto > l.presupuestoOficial) revert SuperaPresupuesto();

        l.ofertaGanadora = ofertaId;
        l.dictamenCID = dictamenCID;
        l.adjudicadaEn = uint64(block.timestamp);
        emit LicitacionAdjudicada(licitacionId, ofertaId, msg.sender, dictamenCID);
    }

    /// @notice Declara desierta la licitación (sin ofertas válidas o ninguna conveniente).
    function declararDesierta(uint256 licitacionId, string calldata dictamenCID) external {
        _exigirEstado(licitacionId, Estado.EVALUACION);
        Licitacion storage l = _licitaciones[licitacionId];
        _exigirEmpleadoDe(l.organismoId);
        if (bytes(dictamenCID).length == 0) revert TextoInvalido();
        l.desierta = true;
        l.dictamenCID = dictamenCID;
        emit LicitacionDesierta(licitacionId, msg.sender, dictamenCID);
    }

    // ---------------------------------------------------------------------
    // 5. Cierre: revelación de identidades
    // ---------------------------------------------------------------------

    /// @notice El proveedor revela, desde su wallet real, que es el autor de una oferta.
    /// @dev Se habilita después de la adjudicación, así la identidad no influye en la elección.
    ///      DUDA: no hay forma de obligar a revelar. Para el ganador es necesario (sin revelar no
    ///      empieza la obra); para los perdedores es voluntario. Faltaría definir qué pasa si el
    ///      ganador no revela en un plazo (¿se readjudica a la segunda?).
    ///      LIMITACIÓN: dos proveedores habilitados que se pongan de acuerdo podrían "prestarse" la
    ///      autoría (A oferta poniendo la wallet de B en el compromiso). Ambos están habilitados,
    ///      pero se rompería "una oferta por empresa". Evitarlo sin romper el anonimato requiere
    ///      otra prueba ZK al revelar.
    function revelarAutoria(uint256 licitacionId, uint256 ofertaId, bytes32 sal) external {
        Licitacion storage l = _licitacion(licitacionId);
        if (l.ofertaGanadora == 0 && !l.desierta) revert FueraDePlazo(estado(licitacionId));
        Oferta storage o = _oferta(licitacionId, ofertaId);
        if (o.autor != address(0)) revert AutoriaYaRevelada();
        if (keccak256(abi.encode(licitacionId, msg.sender, sal)) != o.compromisoAutoria) revert AutoriaIncorrecta();
        if (!credenciales.tieneRolActivo(msg.sender, ICredencialNFT.Rol.PROVEEDOR)) {
            revert SinRol(ICredencialNFT.Rol.PROVEEDOR);
        }

        o.autor = msg.sender;
        bool ganadora = ofertaId == l.ofertaGanadora;
        if (ganadora) l.contratista = msg.sender;
        emit AutoriaRevelada(licitacionId, ofertaId, msg.sender, ganadora);
    }

    // ---------------------------------------------------------------------
    // 6. Ejecución: inspectores y etapas
    // ---------------------------------------------------------------------

    /// @notice Un empleado del organismo asigna un inspector a la obra.
    /// @dev DUDA: ¿el inspector tiene que ser del mismo organismo o de un organismo de control externo?
    ///      Por ahora se acepta cualquier inspector con credencial vigente.
    function asignarInspector(uint256 licitacionId, address inspector) external {
        Licitacion storage l = _licitacion(licitacionId);
        _exigirEmpleadoDe(l.organismoId);
        if (!credenciales.tieneRolActivo(inspector, ICredencialNFT.Rol.INSPECTOR)) revert SinRol(ICredencialNFT.Rol.INSPECTOR);
        if (_esInspector[licitacionId][inspector]) revert InspectorYaAsignado();
        _esInspector[licitacionId][inspector] = true;
        _inspectores[licitacionId].push(inspector);
        emit InspectorAsignado(licitacionId, inspector);
    }

    /// @notice El inspector registra su evaluación de la siguiente etapa pendiente.
    /// @dev Si no la aprueba, queda registrada la observación y la etapa sigue pendiente.
    ///      Los pagos por hitos (escrow) quedan para una versión posterior (no objetivo del RFC):
    ///      este sería el punto donde se liberaría el porcentaje de la etapa.
    function registrarEvaluacion(uint256 licitacionId, uint256 etapa, bool aprobada, string calldata informeCID) external {
        Licitacion storage l = _licitacion(licitacionId);
        if (!_esInspector[licitacionId][msg.sender]) revert NoEsInspectorAsignado();
        if (!credenciales.tieneRolActivo(msg.sender, ICredencialNFT.Rol.INSPECTOR)) revert SinRol(ICredencialNFT.Rol.INSPECTOR);
        if (l.contratista == address(0)) revert SinContratista();
        if (etapa != l.etapasAprobadas || etapa >= l.porcentajesEtapas.length) revert EtapaIncorrecta();
        if (bytes(informeCID).length == 0) revert TextoInvalido();

        if (aprobada) l.etapasAprobadas++;
        emit EvaluacionRegistrada(licitacionId, etapa, msg.sender, aprobada, informeCID);
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
        if (block.timestamp <= l.finApertura) return Estado.APERTURA;
        return Estado.EVALUACION;
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
