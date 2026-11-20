// Referencias a los elementos del DOM
const zonaDeRespuesta = document.getElementById("zona-de-respuesta");
const zonaDeEscritura = document.getElementById("zona-de-escritura");
const entradaMensaje = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const contadorCaracteres = document.getElementById("contador-caracteres");

// Constantes de configuración de envío
const MAX_CARACTERES = 500;
const PAUSA_MINIMA_MS = 1500;
const TIEMPO_LIMITE_MS = 30000;

// Variable en memoria como respaldo si localStorage falla
let sessionIdMemoria = null;
let ultimoEnvioTimestamp = 0;

/**
 * Obtiene o crea un identificador de sesión único y lo persiste.
 */
function obtenerSessionId() {
  const claveStorage = "chef_session_id";

  try {
    const guardado = localStorage.getItem(claveStorage);
    if (guardado) {
      return guardado;
    }
  } catch (error) {
    // Si localStorage está bloqueado, continuamos con memoria
  }

  if (sessionIdMemoria) {
    return sessionIdMemoria;
  }

  // Generar UUID o alternativa segura
  const nuevoId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `sesion-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  sessionIdMemoria = nuevoId;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (error) {
    // Respaldo ya guardado en sessionIdMemoria
  }

  return nuevoId;
}

// Inicializar sesión al cargar la aplicación
const sessionId = obtenerSessionId();

/**
 * Actualiza el contador visual de caracteres.
 */
function actualizarContador() {
  const longitudActual = entradaMensaje.value.length;
  contadorCaracteres.textContent = `${longitudActual} / ${MAX_CARACTERES}`;
}

/**
 * Crea y agrega una burbuja de mensaje en la zona de respuesta usando textContent.
 */
function agregarBurbuja(texto, tipo, autorTexto) {
  const burbuja = document.createElement("div");
  burbuja.classList.add("mensaje", `mensaje-${tipo}`);

  if (autorTexto) {
    const etiquetaAutor = document.createElement("span");
    etiquetaAutor.classList.add("autor");
    etiquetaAutor.textContent = autorTexto;
    burbuja.appendChild(etiquetaAutor);
  }

  const parrafo = document.createElement("p");
  parrafo.classList.add("texto-mensaje");
  parrafo.textContent = texto;
  burbuja.appendChild(parrafo);

  zonaDeRespuesta.appendChild(burbuja);
  zonaDeRespuesta.scrollTop = zonaDeRespuesta.scrollHeight;

  return burbuja;
}

/**
 * Habilita o deshabilita los controles de escritura.
 */
function establecerEstadoControles(deshabilitado) {
  entradaMensaje.disabled = deshabilitado;
  botonEnviar.disabled = deshabilitado;
}

/**
 * Extrae el texto válido según las reglas de prioridad del contrato con Make.
 */
function procesarTextoRespuesta(textoCrudo) {
  if (!textoCrudo || textoCrudo.trim() === "") {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(textoCrudo);

    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      const propiedadesPrioridad = ["response", "respuesta", "message", "mensaje"];

      for (const prop of propiedadesPrioridad) {
        if (typeof datos[prop] === "string" && datos[prop].trim() !== "") {
          return datos[prop];
        }
      }

      return "Make respondió, pero sin el campo response";
    }
  } catch (error) {
    // No es JSON válido: devolvemos el texto recibido tal cual
  }

  return textoCrudo;
}

/**
 * Gestiona el envío del mensaje hacia el webhook de Make.
 */
async function manejarEnvio(evento) {
  evento.preventDefault();

  const mensajeLimpio = entradaMensaje.value.trim();

  // Validación de contenido y longitud máxima
  if (!mensajeLimpio) {
    return;
  }

  if (mensajeLimpio.length > MAX_CARACTERES) {
    agregarBurbuja(`El mensaje no puede superar los ${MAX_CARACTERES} caracteres.`, "error", "Aviso");
    return;
  }

  // Verificar pausa mínima de 1,5 segundos entre envíos
  const ahora = Date.now();
  if (ahora - ultimoEnvioTimestamp < PAUSA_MINIMA_MS) {
    return;
  }

  // Verificar configuración del webhook
  if (typeof WEBHOOK_URL === "undefined" || !WEBHOOK_URL.trim() || WEBHOOK_URL.includes("ACA VA")) {
    agregarBurbuja("Falta pegar la URL de tu webhook en config.js", "error", "Configuración");
    return;
  }

  // Mostrar mensaje del usuario y limpiar caja de texto
  agregarBurbuja(mensajeLimpio, "usuario", "Vos");
  entradaMensaje.value = "";
  actualizarContador();

  // Estado visual: cargando
  ultimoEnvioTimestamp = Date.now();
  establecerEstadoControles(true);
  const burbujaCargando = agregarBurbuja("Chef está pensando una receta dulce...", "cargando", "Chef 🧁");

  const controladorAborto = new AbortController();
  const temporizador = setTimeout(() => controladorAborto.abort(), TIEMPO_LIMITE_MS);

  const cuerpoPeticion = JSON.stringify({
    sessionId: sessionId,
    mensaje: mensajeLimpio,
    fecha: new Date().toISOString()
  });

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: cuerpoPeticion,
      signal: controladorAborto.signal
    });

    const textoServidor = await respuesta.text();
    burbujaCargando.remove();

    if (!respuesta.ok) {
      agregarBurbuja(
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
        "error",
        "Error de Make"
      );
      return;
    }

    // Estado visual: éxito
    const mensajeFinal = procesarTextoRespuesta(textoServidor);
    agregarBurbuja(mensajeFinal, "agente", "Chef 🧁");

  } catch (error) {
    burbujaCargando.remove();

    // Estado visual: error (timeout o red)
    if (error.name === "AbortError") {
      agregarBurbuja("Se agotó el tiempo de espera (30 segundos). Intentá de nuevo.", "error", "Tiempo agotado");
    } else {
      agregarBurbuja("Error de red al conectar con Chef. Verificá tu conexión a internet.", "error", "Error de red");
    }
  } finally {
    clearTimeout(temporizador);
    establecerEstadoControles(false);
    entradaMensaje.focus();
  }
}

// Escuchadores de eventos
entradaMensaje.addEventListener("input", actualizarContador);
zonaDeEscritura.addEventListener("submit", manejarEnvio);

// Permitir enviar con Enter (y salto de línea con Shift + Enter)
entradaMensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    zonaDeEscritura.requestSubmit();
  }
});
