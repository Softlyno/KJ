/**
 * @file chatbot.js
 * @description Widget de chatbot con menú de ventas y redirección a WhatsApp.
 *              Incluye asignación fija de agente por producto y rotación
 *              automática (round-robin) para los demás productos.
 *
 * Dependencias: ninguna (vanilla JS, ES5 compatible).
 * Persistencia:  localStorage  →  clave "cb_rr_idx"
 */

(function () {
  'use strict';

  /* =============================================================
     CONFIGURACIÓN
     Edita esta sección para adaptar el chatbot a tu negocio.
     Formato de teléfono: código de país + número (sin espacios).
     Ejemplo México: 52 + 10 dígitos  →  "5214771234567"
  ============================================================= */

  /**
   * @typedef  {Object} Agent
   * @property {string} name  - Nombre completo del agente.
   * @property {string} phone - Teléfono para el enlace de WhatsApp.
   * @property {string} role  - Puesto o área del agente.
   */

  /** @type {Object.<string, Agent>} */
  var AGENTS = {
    marianita: { name: 'Marianita López',    phone: '5214771110001', role: 'Ventas — Especialista Producto 1' },
    pepe:      { name: 'Pepe Hernández',     phone: '5214772220002', role: 'Ventas' },
    ana:       { name: 'Ana Ramírez',        phone: '5214773330003', role: 'Ventas' },
    carlos:    { name: 'Carlos Torres',      phone: '5214774440004', role: 'Ventas' },
    servicio:  { name: 'Soporte al cliente', phone: '5214775550005', role: 'Servicio al cliente' },
    gerente:   { name: 'Roberto Gutiérrez',  phone: '5214776660006', role: 'Gerencia General' }
  };

  /**
   * @typedef  {Object} Product
   * @property {number}      id    - Identificador único del producto.
   * @property {string}      name  - Nombre del producto.
   * @property {string}      desc  - Descripción breve.
   * @property {string}      emoji - Ícono representativo.
   * @property {string|null} fixed - Clave del agente fijo, o null para rotación.
   */

  /** @type {Product[]} */
  var PRODUCTS = [
    { id: 1, name: 'Pegamento Ultra Fuerte', desc: 'Extra resistente, todo uso',         emoji: '💪', fixed: 'marianita' },
    { id: 2, name: 'Pegamento Rápido',       desc: 'Seca en 30 segundos',                emoji: '⚡', fixed: null },
    { id: 3, name: 'Pegamento Flexible',     desc: 'Para superficies irregulares',        emoji: '🔄', fixed: null },
    { id: 4, name: 'Pegamento Industrial',   desc: 'Alta temperatura y presión',          emoji: '🏭', fixed: null }
  ];

  /**
   * Agentes que participan en la rotación (round-robin).
   * Solo se usan para productos con fixed = null.
   * @type {string[]}
   */
  var RR_AGENTS = ['pepe', 'ana', 'carlos'];

  /** Clave de persistencia en localStorage. @type {string} */
  var RR_KEY = 'cb_rr_idx';

  /* =============================================================
     ESTADO INTERNO
  ============================================================= */

  /** Historial de mensajes renderizados. @type {Object[]} */
  var messages = [];

  /** Indica si el panel del chat está visible. @type {boolean} */
  var isOpen = false;

  /* =============================================================
     REFERENCIAS AL DOM
  ============================================================= */

  var toggleBtn = document.getElementById('cb-toggle');
  var popup     = document.getElementById('cb-popup');
  var msgsEl    = document.getElementById('cb-messages');
  var optsEl    = document.getElementById('cb-options');

  /* =============================================================
     ROUND-ROBIN — ASIGNACIÓN POR TURNO
  ============================================================= */

  /**
   * Lee el índice de rotación actual desde localStorage.
   * Si no existe o está corrupto devuelve 0.
   * @returns {number}
   */
  function getRRIndex() {
    var value = parseInt(localStorage.getItem(RR_KEY), 10);
    return isNaN(value) ? 0 : value;
  }

  /**
   * Persiste el índice de rotación en localStorage.
   * @param {number} index
   */
  function setRRIndex(index) {
    localStorage.setItem(RR_KEY, String(index));
  }

  /**
   * Devuelve la clave del siguiente agente en la rotación
   * y avanza el puntero para la próxima asignación.
   * @returns {string} Clave del agente (e.g. 'pepe', 'ana', 'carlos').
   */
  function getNextAgent() {
    var index    = getRRIndex();
    var agentKey = RR_AGENTS[index % RR_AGENTS.length];
    setRRIndex((index + 1) % RR_AGENTS.length);
    return agentKey;
  }

  /* =============================================================
     UTILIDADES
  ============================================================= */

  /**
   * Devuelve la hora actual formateada (HH:MM).
   * @returns {string}
   */
  function getCurrentTime() {
    return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Escapa caracteres HTML especiales para prevenir XSS
   * cuando se inserta texto de usuario en el DOM.
   * @param   {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Construye la URL de WhatsApp con mensaje predefinido.
   * @param   {string} phone - Teléfono del agente.
   * @param   {string} text  - Mensaje que se pre-carga en el chat.
   * @returns {string} URL lista para usar en href.
   */
  function buildWhatsAppUrl(phone, text) {
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }

  /* =============================================================
     RENDERIZADO DE MENSAJES
  ============================================================= */

  /**
   * Genera el HTML de un único mensaje según su tipo.
   * @param   {Object} msg - Objeto de mensaje del array messages[].
   * @returns {string} Fragmento HTML.
   */
  function renderMessage(msg) {
    if (msg.type === 'typing') {
      return '<div class="cb-msg in">' +
               '<div class="cb-typing">' +
                 '<div class="cb-dot"></div>' +
                 '<div class="cb-dot"></div>' +
                 '<div class="cb-dot"></div>' +
               '</div>' +
             '</div>';
    }

    if (msg.type === 'divider') {
      return '<div class="cb-divider">' + escapeHtml(msg.text) + '</div>';
    }

    var side = (msg.direction === 'out') ? 'out' : 'in';
    return '<div class="cb-msg ' + side + '">' +
             msg.html +
             '<div class="cb-msg-time">' + msg.time + '</div>' +
           '</div>';
  }

  /**
   * Vuelca el array messages[] al DOM y hace scroll
   * al último mensaje automáticamente.
   */
  function renderAllMessages() {
    msgsEl.innerHTML = messages.map(renderMessage).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /**
   * Agrega un mensaje al historial y actualiza el DOM.
   * @param {string} htmlContent - Contenido HTML del mensaje.
   * @param {string} direction   - 'in' (bot) | 'out' (usuario).
   */
  function addMessage(htmlContent, direction) {
    messages.push({ html: htmlContent, direction: direction, time: getCurrentTime() });
    renderAllMessages();
  }

  /* =============================================================
     INDICADOR "ESCRIBIENDO…"
  ============================================================= */

  /**
   * Muestra los tres puntos animados de "escribiendo..." y
   * devuelve un ID único para poder eliminarlo después.
   * @returns {number} ID del indicador.
   */
  function showTyping() {
    var id = Date.now();
    messages.push({ type: 'typing', id: id });
    renderAllMessages();
    return id;
  }

  /**
   * Elimina el indicador de "escribiendo..." por su ID.
   * @param {number} id - ID devuelto por showTyping().
   */
  function removeTyping(id) {
    messages = messages.filter(function (m) { return m.id !== id; });
  }

  /* =============================================================
     PANEL DE OPCIONES
  ============================================================= */

  /** Vacía el panel de botones de opción. */
  function clearOptions() {
    optsEl.innerHTML = '';
  }

  /* =============================================================
     PANTALLAS DEL CHATBOT
  ============================================================= */

  /** Muestra el menú principal con las tres opciones de atención. */
  function showMainMenu() {
    optsEl.innerHTML =
      '<div class="cb-opt-label">¿En qué te puedo ayudar?</div>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'comprar\')">' +
        '<span class="cb-opt-icon">🛒</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Quiero comprar un producto</span></span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'servicio\')">' +
        '<span class="cb-opt-icon">🎧</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Servicio al cliente</span></span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'gerente\')">' +
        '<span class="cb-opt-icon">👔</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Hablar con el gerente</span></span>' +
      '</button>';
  }

  /**
   * Muestra la lista de productos disponibles para compra.
   * Incluye nombre, descripción breve y botón "Volver".
   */
  function showProductList() {
    var buttons = PRODUCTS.map(function (product) {
      return '<button class="cb-opt-btn" onclick="cbPickProduct(' + product.id + ')">' +
               '<span class="cb-opt-icon">' + product.emoji + '</span>' +
               '<span class="cb-opt-meta">' +
                 '<span class="cb-opt-title">' + escapeHtml(product.name)  + '</span>' +
                 '<span class="cb-opt-sub">'   + escapeHtml(product.desc)  + '</span>' +
               '</span>' +
             '</button>';
    }).join('');

    optsEl.innerHTML =
      '<div class="cb-opt-label">Selecciona el producto:</div>' +
      buttons +
      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';
  }

  /**
   * Muestra la tarjeta del agente asignado y el botón
   * que abre WhatsApp con el mensaje pre-cargado.
   *
   * @param {Agent}       agent       - Agente asignado.
   * @param {string}      waText      - Mensaje inicial para WhatsApp.
   * @param {string|null} productName - Nombre del producto (null si no aplica).
   * @param {boolean}     isFixed     - true = agente fijo, false = asignado por turno.
   */
  function showWhatsAppPanel(agent, waText, productName, isFixed) {
    var badge = '';
    if (productName !== null) {
      badge = isFixed
        ? '<div class="cb-badge">✦ Especialista en este producto</div>'
        : '<div class="cb-badge">📋 Asignado por turno</div>';
    }

    var waIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
        '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
        '<path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.979-1.304A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.97 7.97 0 01-4.076-1.117l-.292-.174-3.027.794.808-2.96-.19-.304A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>' +
      '</svg>';

    optsEl.innerHTML =
      '<div class="cb-agent-card">' +
        '<div class="cb-agent-name">' + escapeHtml(agent.name) + '</div>' +
        '<div class="cb-agent-role">' + escapeHtml(agent.role) + '</div>' +
        badge +
      '</div>' +

      '<a class="cb-wa-btn" href="' + buildWhatsAppUrl(agent.phone, waText) + '" target="_blank" rel="noopener noreferrer">' +
        waIconSvg +
        'Abrir WhatsApp con ' + escapeHtml(agent.name) +
      '</a>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú principal</button>';
  }

  /* =============================================================
     MANEJADORES DE EVENTOS (EXPUESTOS AL HTML)
     Se asignan a window para que los botones generados con
     innerHTML puedan invocarlos.
  ============================================================= */

  /**
   * Procesa la selección del menú principal.
   * @param {string} option - 'comprar' | 'servicio' | 'gerente'
   */
  window.cbPickMenu = function (option) {
    var labels = {
      comprar:  'Quiero comprar un producto',
      servicio: 'Servicio al cliente',
      gerente:  'Hablar con el gerente'
    };

    addMessage(escapeHtml(labels[option]), 'out');
    clearOptions();

    var typingId = showTyping();

    setTimeout(function () {
      removeTyping(typingId);

      if (option === 'comprar') {
        addMessage('¡Perfecto! Estos son nuestros productos disponibles:', 'in');
        showProductList();

      } else if (option === 'servicio') {
        var agent = AGENTS.servicio;
        addMessage('Con gusto te comunico con <strong>' + escapeHtml(agent.name) + '</strong>. Da clic para abrir WhatsApp:', 'in');
        showWhatsAppPanel(agent, 'Hola, necesito ayuda de servicio al cliente 😊', null, false);

      } else if (option === 'gerente') {
        var manager = AGENTS.gerente;
        addMessage('Te paso directamente con <strong>' + escapeHtml(manager.name) + '</strong>:', 'in');
        showWhatsAppPanel(manager, 'Hola, me gustaría hablar con el gerente 😊', null, false);
      }

      renderAllMessages();
    }, 700);
  };

  /**
   * Procesa la selección de un producto.
   * Asigna agente fijo o por rotación según la configuración del producto.
   * @param {number} productId - ID del producto seleccionado.
   */
  window.cbPickProduct = function (productId) {
    var product = null;
    for (var i = 0; i < PRODUCTS.length; i++) {
      if (PRODUCTS[i].id === productId) {
        product = PRODUCTS[i];
        break;
      }
    }
    if (!product) return;

    addMessage(product.emoji + ' ' + escapeHtml(product.name), 'out');
    clearOptions();

    /* Agente fijo si el producto lo tiene, de lo contrario siguiente en rotación */
    var agentKey = product.fixed ? product.fixed : getNextAgent();
    var agent    = AGENTS[agentKey];
    var isFixed  = !!product.fixed;

    var typingId = showTyping();

    setTimeout(function () {
      removeTyping(typingId);
      addMessage(
        '¡Excelente elección! Te asigno con <strong>' + escapeHtml(agent.name) + '</strong> para atenderte.',
        'in'
      );
      var waText = 'Hola ' + agent.name + ', me interesa el ' + product.name + ' 😊';
      showWhatsAppPanel(agent, waText, product.name, isFixed);
      renderAllMessages();
    }, 750);
  };

  /** Regresa al menú principal desde cualquier pantalla. */
  window.cbGoBack = function () {
    addMessage('↩ Menú principal', 'out');
    clearOptions();

    var typingId = showTyping();
    setTimeout(function () {
      removeTyping(typingId);
      addMessage('Claro, ¿en qué más te puedo ayudar?', 'in');
      showMainMenu();
      renderAllMessages();
    }, 450);
  };

  /* =============================================================
     CONTROL DE VISIBILIDAD DEL PANEL
  ============================================================= */

  /** Abre el panel del chat. */
  function openChat() {
    isOpen = true;
    popup.classList.add('cb-open');
    toggleBtn.classList.add('cb-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /** Cierra el panel del chat. */
  function closeChat() {
    isOpen = false;
    popup.classList.remove('cb-open');
    toggleBtn.classList.remove('cb-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  /* Botón flotante: alterna entre abrir y cerrar */
  toggleBtn.addEventListener('click', function () {
    isOpen ? closeChat() : openChat();
  });

  /* Tecla Escape: cierra el panel si está abierto */
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isOpen) closeChat();
  });

  /* =============================================================
     INICIALIZACIÓN
  ============================================================= */

  (function init() {
    var typingId = showTyping();
    setTimeout(function () {
      removeTyping(typingId);
      addMessage('¡Hola! 👋 Bienvenido. Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?', 'in');
      showMainMenu();
      renderAllMessages();
    }, 600);
  })();

})();