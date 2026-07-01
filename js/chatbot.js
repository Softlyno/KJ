/**
 * @file chatbot.js
 * @description Widget web de chatbot para KayserBond.
 *              Flujo tipo WhatsApp bot:
 *              - Menú principal
 *              - Catálogo
 *              - Precios
 *              - Pedido
 *              - Asesoría técnica
 *              - Folio automático
 *              - Redirección a WhatsApp con resumen
 *
 * Dependencias: ninguna.
 * Requiere estos IDs en HTML:
 * - cb-toggle
 * - cb-popup
 * - cb-messages
 * - cb-options
 */

(function () {
  'use strict';

  /* =============================================================
     CONFIGURACIÓN
  ============================================================= */

  var CONFIG = {
    companyName: 'KayserBond',

    // Si tienes el PDF en tu web, pon aquí la ruta.
    // Ejemplo: '/catalogo-kayserbond.pdf'
    catalogUrl: 'catalogo-kayserbond.pdf',

    businessStartHour: 6,
    businessEndHour: 18,
    timeZone: 'America/Mexico_City',

    folioKey: 'cb_folio_number',
    rrKey: 'cb_rr_idx'
  };

  var AGENTS = {
    ventas1:  { name: 'Vendedor principal', phone: '5213329405373', role: 'Ventas' },
    pepe:     { name: 'Pepe Hernández',     phone: '5214772220002', role: 'Ventas' },
    ana:      { name: 'Ana Ramírez',        phone: '5214773330003', role: 'Ventas' },
    carlos:   { name: 'Carlos Torres',      phone: '5214774440004', role: 'Ventas' },
    servicio: { name: 'Soporte al cliente', phone: '5214775550005', role: 'Servicio al cliente' },
    gerente:  { name: 'Roberto Gutiérrez',  phone: '5214776660006', role: 'Gerencia General' }
  };

  var RR_AGENTS = ['pepe', 'ana', 'carlos'];

  var GIRO_OPTIONS = [
    'Calzado',
    'Mueblería',
    'Marroquinería',
    'Tapicería',
    'Automotriz',
    'Colchonería',
    'Otros'
  ];

  /* =============================================================
     ESTADO
  ============================================================= */

  var messages = [];
  var isOpen = false;

  var flow = {
    step: 'menu',
    data: {}
  };

  /* =============================================================
     DOM
  ============================================================= */

  var toggleBtn = document.getElementById('cb-toggle');
  var popup     = document.getElementById('cb-popup');
  var msgsEl    = document.getElementById('cb-messages');
  var optsEl    = document.getElementById('cb-options');

  /* =============================================================
     UTILIDADES
  ============================================================= */

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeText(text) {
    return String(text || '').trim().toLowerCase();
  }

  function onlyDigits(text) {
    return String(text || '').replace(/\D/g, '');
  }

  function getCurrentTime() {
    return new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function buildWhatsAppUrl(phone, text) {
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }

  function getRRIndex() {
    var value = parseInt(localStorage.getItem(CONFIG.rrKey), 10);
    return isNaN(value) ? 0 : value;
  }

  function setRRIndex(index) {
    localStorage.setItem(CONFIG.rrKey, String(index));
  }

  function getNextAgent() {
    var index = getRRIndex();
    var agentKey = RR_AGENTS[index % RR_AGENTS.length];
    setRRIndex((index + 1) % RR_AGENTS.length);
    return AGENTS[agentKey];
  }

  function createFolio() {
    var current = parseInt(localStorage.getItem(CONFIG.folioKey), 10);
    if (isNaN(current)) current = 0;

    current += 1;
    localStorage.setItem(CONFIG.folioKey, String(current));

    return 'K' + String(current).padStart(4, '0');
  }

  function getMexicoHour() {
    try {
      var hour = new Intl.DateTimeFormat('en-US', {
        timeZone: CONFIG.timeZone,
        hour: '2-digit',
        hour12: false
      }).format(new Date());

      return parseInt(hour, 10);
    } catch (e) {
      return new Date().getHours();
    }
  }

  function isBusinessHours() {
    var hour = getMexicoHour();
    return hour >= CONFIG.businessStartHour && hour < CONFIG.businessEndHour;
  }

  function businessHoursText() {
    return '6:00 AM a 6:00 PM';
  }

  function resetFlow() {
    flow = {
      step: 'menu',
      data: {}
    };
  }

  function clearOptions() {
    optsEl.innerHTML = '';
  }

  /* =============================================================
     RENDER MENSAJES
  ============================================================= */

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

    var side = msg.direction === 'out' ? 'out' : 'in';

    return '<div class="cb-msg ' + side + '">' +
             msg.html +
             '<div class="cb-msg-time">' + msg.time + '</div>' +
           '</div>';
  }

  function renderAllMessages() {
    msgsEl.innerHTML = messages.map(renderMessage).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function addMessage(htmlContent, direction) {
    messages.push({
      html: htmlContent,
      direction: direction,
      time: getCurrentTime()
    });

    renderAllMessages();
  }

  function showTyping() {
    var id = Date.now() + Math.floor(Math.random() * 999);
    messages.push({ type: 'typing', id: id });
    renderAllMessages();
    return id;
  }

  function removeTyping(id) {
    messages = messages.filter(function (m) {
      return m.id !== id;
    });
    renderAllMessages();
  }

  function botReply(html, callback) {
    clearOptions();

    var typingId = showTyping();

    setTimeout(function () {
      removeTyping(typingId);
      addMessage(html, 'in');

      if (typeof callback === 'function') callback();

      renderAllMessages();
    }, 500);
  }

  /* =============================================================
     COMPONENTES UI
  ============================================================= */

function showMainMenu() {
  optsEl.innerHTML =
    '<div class="cb-opt-label">Selecciona una opción:</div>' +

    '<button class="cb-opt-btn" onclick="cbPickMenu(\'catalogo\')">' +
      '<span class="cb-opt-icon">📄</span>' +
      '<span class="cb-opt-meta">' +
        '<span class="cb-opt-title">Ver catálogo / variedades</span>' +
        '<span class="cb-opt-sub">Productos disponibles</span>' +
      '</span>' +
    '</button>' +

    '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
      '<span class="cb-opt-icon">💲</span>' +
      '<span class="cb-opt-meta">' +
        '<span class="cb-opt-title">Consultar precios</span>' +
        '<span class="cb-opt-sub">Te pedimos producto y cantidad</span>' +
      '</span>' +
    '</button>' +

    '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
      '<span class="cb-opt-icon">🛒</span>' +
      '<span class="cb-opt-meta">' +
        '<span class="cb-opt-title">Hacer pedido</span>' +
        '<span class="cb-opt-sub">Registramos datos básicos</span>' +
      '</span>' +
    '</button>' +

    '<button class="cb-opt-btn" onclick="cbPickMenu(\'asesoria\')">' +
      '<span class="cb-opt-icon">🧪</span>' +
      '<span class="cb-opt-meta">' +
        '<span class="cb-opt-title">Asesoría técnica</span>' +
        '<span class="cb-opt-sub">Materiales, condiciones y objetivo</span>' +
      '</span>' +
    '</button>';
}

  function showTextInput(label, placeholder) {
    optsEl.innerHTML =
      '<div class="cb-opt-label">' + escapeHtml(label) + '</div>' +
      '<div class="cb-input-wrap">' +
        '<input id="cb-text-input" class="cb-text-input" type="text" placeholder="' + escapeHtml(placeholder || '') + '" ' +
        'onkeydown="if(event.key===\'Enter\'){cbSubmitText();}">' +
        '<button class="cb-send-btn" onclick="cbSubmitText()">Enviar</button>' +
      '</div>' +
      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';

    setTimeout(function () {
      var input = document.getElementById('cb-text-input');
      if (input) input.focus();
    }, 50);
  }

  function showGiroOptions() {
    var html = '<div class="cb-opt-label">Selecciona el giro de tu empresa:</div>';

    for (var i = 0; i < GIRO_OPTIONS.length; i++) {
      html +=
        '<button class="cb-opt-btn" onclick="cbPickGiro(\'' + escapeHtml(GIRO_OPTIONS[i]) + '\')">' +
          '<span class="cb-opt-icon">' + (i + 1) + '</span>' +
          '<span class="cb-opt-meta">' +
            '<span class="cb-opt-title">' + escapeHtml(GIRO_OPTIONS[i]) + '</span>' +
          '</span>' +
        '</button>';
    }

    html += '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';

    optsEl.innerHTML = html;
  }

  function showCatalogOptions() {
    optsEl.innerHTML =
      '<a class="cb-wa-btn" href="' + escapeHtml(CONFIG.catalogUrl) + '" target="_blank" rel="noopener noreferrer">' +
        '📄 Abrir catálogo PDF' +
      '</a>' +
      '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
        '<span class="cb-opt-icon">💲</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Consultar precios</span></span>' +
      '</button>' +
      '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
        '<span class="cb-opt-icon">🛒</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Hacer pedido</span></span>' +
      '</button>' +
      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';
  }

  function showWhatsAppPanel(agent, waText) {
    var waIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
        '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>' +
        '<path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.979-1.304A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.97 7.97 0 01-4.076-1.117l-.292-.174-3.027.794.808-2.96-.19-.304A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/>' +
      '</svg>';

    optsEl.innerHTML =
      '<div class="cb-agent-card">' +
        '<div class="cb-agent-name">' + escapeHtml(agent.name) + '</div>' +
        '<div class="cb-agent-role">' + escapeHtml(agent.role) + '</div>' +
        '<div class="cb-badge">📋 Atención por WhatsApp</div>' +
      '</div>' +

      '<a class="cb-wa-btn" href="' + buildWhatsAppUrl(agent.phone, waText) + '" target="_blank" rel="noopener noreferrer">' +
        waIconSvg +
        'Abrir WhatsApp con ' + escapeHtml(agent.name) +
      '</a>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú principal</button>';
  }

  /* =============================================================
     RESÚMENES
  ============================================================= */

  function buildSummary(type, folio) {
    var d = flow.data;
    var lines = [];

    lines.push('Hola, vengo desde la página web de ' + CONFIG.companyName + '.');
    lines.push('');
    lines.push('Folio: ' + folio);
    lines.push('Motivo: ' + type);
    lines.push('');

    if (d.name) lines.push('Nombre: ' + d.name);
    if (d.phone) lines.push('Teléfono: ' + d.phone);
    if (d.producto) lines.push('Producto: ' + d.producto);
    if (d.presentacion) lines.push('Presentación: ' + d.presentacion);
    if (d.cantidad) lines.push('Cantidad: ' + d.cantidad);
    if (d.giro) lines.push('Giro: ' + d.giro);
    if (d.material) lines.push('Materiales: ' + d.material);
    if (d.condiciones) lines.push('Condiciones: ' + d.condiciones);
    if (d.objetivo) lines.push('Objetivo: ' + d.objetivo);

    return lines.join('\n');
  }

  function finishFlow(type, preferredAgent) {
    var folio = createFolio();
    var agent = preferredAgent || getNextAgent();
    var waText = buildSummary(type, folio);

    botReply(
      'Listo ✅<br><br>' +
      'Ya tengo la información básica.<br><br>' +
      'Tu folio es: <strong>' + escapeHtml(folio) + '</strong><br><br>' +
      'Ahora puedes continuar por WhatsApp con el asesor asignado.',
      function () {
        showWhatsAppPanel(agent, waText);
      }
    );

    flow.step = 'finished';
  }

  /* =============================================================
     FLUJOS
  ============================================================= */

  window.cbPickMenu = function (option) {
    var labels = {
      catalogo: 'Ver catálogo / variedades',
      precios: 'Consultar precios',
      pedido: 'Hacer pedido',
      asesoria: 'Asesoría técnica',
      servicio: 'Servicio al cliente',
      gerente: 'Hablar con gerencia'
    };

    addMessage(escapeHtml(labels[option] || option), 'out');
    clearOptions();

    if (!isBusinessHours()) {
      addMessage(
        'Aviso: nuestro horario de atención es de ' + businessHoursText() +
        '. Aun así puedes dejar tus datos y un asesor dará seguimiento.',
        'in'
      );
    }

    if (option === 'catalogo') {
      resetFlow();
      botReply(
        'Claro ✅<br><br>' +
        'Puedes abrir el catálogo desde el botón de abajo. Después puedes consultar precios o hacer pedido.',
        showCatalogOptions
      );
      return;
    }

    if (option === 'precios') {
      flow.step = 'precio_producto';
      flow.data = {};
      botReply('Con gusto te ayudo a consultar precio.', function () {
        showTextInput('¿Qué producto te interesa?', 'Ejemplo: pegamento industrial');
      });
      return;
    }

    if (option === 'pedido') {
      flow.step = 'order_name';
      flow.data = {};
      botReply('Perfecto, vamos a registrar tu pedido.', function () {
        showTextInput('¿Cuál es tu nombre?', 'Escribe tu nombre');
      });
      return;
    }

    if (option === 'asesoria') {
      flow.step = 'tech_name';
      flow.data = {};
      botReply('Vamos a levantar una ficha básica de asesoría técnica.', function () {
        showTextInput('¿Cuál es tu nombre?', 'Escribe tu nombre');
      });
      return;
    }

    if (option === 'servicio') {
      resetFlow();
      botReply('Con gusto te comunico con servicio al cliente.', function () {
        showWhatsAppPanel(
          AGENTS.servicio,
          'Hola, necesito ayuda de servicio al cliente.'
        );
      });
      return;
    }

    if (option === 'gerente') {
      resetFlow();
      botReply('Te paso directamente con gerencia.', function () {
        showWhatsAppPanel(
          AGENTS.gerente,
          'Hola, me gustaría hablar con gerencia.'
        );
      });
    }
  };

  window.cbSubmitText = function () {
    var input = document.getElementById('cb-text-input');
    if (!input) return;

    var value = String(input.value || '').trim();
    if (!value) return;

    addMessage(escapeHtml(value), 'out');
    clearOptions();

    handleTextAnswer(value);
  };

  function handleTextAnswer(value) {
    var clean = normalizeText(value);

    if (clean === 'menu' || clean === 'menú' || clean === 'reiniciar' || clean === 'inicio') {
      resetFlow();
      botReply('Claro, volvemos al menú principal.', showMainMenu);
      return;
    }

    if (clean === 'test') {
      botReply('✅ El chatbot web sí está recibiendo y respondiendo mensajes.', showMainMenu);
      return;
    }

    switch (flow.step) {
      case 'precio_producto':
        flow.data.producto = value;
        flow.step = 'precio_cantidad';

        botReply('Gracias. Ahora dime la cantidad aproximada que necesitas.', function () {
          showTextInput('¿Qué cantidad necesitas?', 'Ejemplo: 10 piezas, 1 caja, 5 litros');
        });
        break;

      case 'precio_cantidad':
        flow.data.cantidad = value;
        finishFlow('Consulta de precio', getNextAgent());
        break;

      case 'order_name':
        flow.data.name = value;
        flow.step = 'order_product';

        botReply('Gracias, ' + escapeHtml(value) + '.', function () {
          showTextInput('¿Qué producto deseas?', 'Escribe el producto');
        });
        break;

      case 'order_product':
        flow.data.producto = value;
        flow.step = 'order_presentation';

        botReply('Perfecto.', function () {
          showTextInput('¿En qué presentación lo necesitas?', 'Ejemplo: 1L, cubeta, caja, tubo');
        });
        break;

      case 'order_presentation':
        flow.data.presentacion = value;
        flow.step = 'order_quantity';

        botReply('Muy bien.', function () {
          showTextInput('¿Qué cantidad necesitas?', 'Ejemplo: 2 cajas, 10 piezas, 5 litros');
        });
        break;

      case 'order_quantity':
        flow.data.cantidad = value;
        finishFlow('Pedido', AGENTS.ventas1);
        break;

      case 'tech_name':
        flow.data.name = value;
        flow.step = 'tech_phone';

        botReply('Gracias, ' + escapeHtml(value) + '.', function () {
          showTextInput('¿Cuál es tu número de teléfono?', 'Escribe tu teléfono');
        });
        break;

      case 'tech_phone':
        var phone = onlyDigits(value);

        if (phone.length < 7 || phone.length > 15) {
          botReply('No entendí el teléfono. Escríbelo solo con números.', function () {
            showTextInput('¿Cuál es tu número de teléfono?', 'Ejemplo: 4771234567');
          });
          return;
        }

        flow.data.phone = phone;
        flow.step = 'tech_giro';

        botReply('Gracias. Ahora dime el giro de tu empresa.', showGiroOptions);
        break;

      case 'tech_giro_detail':
        flow.data.giro = value;
        flow.step = 'tech_material';

        botReply('Gracias.', function () {
          showTextInput('¿Qué materiales vas a pegar, unir, sellar o trabajar?', 'Ejemplo: piel con hule, madera con tela');
        });
        break;

      case 'tech_material':
        flow.data.material = value;
        flow.step = 'tech_conditions';

        botReply('Entendido.', function () {
          showTextInput(
            '¿En qué condiciones se usará el producto?',
            'Ejemplo: calor, humedad, agua, sol, fricción'
          );
        });
        break;

      case 'tech_conditions':
        flow.data.condiciones = value;
        flow.step = 'tech_goal';

        botReply('Perfecto.', function () {
          showTextInput(
            '¿Qué necesitas que logre el producto?',
            'Ejemplo: pegar fuerte, secar rápido, resistir calor'
          );
        });
        break;

      case 'tech_goal':
        flow.data.objetivo = value;
        finishFlow('Asesoría técnica', AGENTS.ventas1);
        break;

      default:
        botReply('No entendí tu respuesta. Te muestro el menú principal.', showMainMenu);
        resetFlow();
        break;
    }
  }

  window.cbPickGiro = function (giro) {
    addMessage(escapeHtml(giro), 'out');
    clearOptions();

    if (normalizeText(giro) === 'otros') {
      flow.step = 'tech_giro_detail';

      botReply('Claro. Especifica el giro de tu empresa.', function () {
        showTextInput('¿Cuál es el giro de tu empresa?', 'Escribe el giro');
      });

      return;
    }

    flow.data.giro = giro;
    flow.step = 'tech_material';

    botReply('Gracias.', function () {
      showTextInput('¿Qué materiales vas a pegar, unir, sellar o trabajar?', 'Ejemplo: piel con hule, madera con tela');
    });
  };

  window.cbGoBack = function () {
    addMessage('↩ Menú principal', 'out');
    resetFlow();
    clearOptions();

    botReply('Claro, ¿en qué más te puedo ayudar?', showMainMenu);
  };

  /* =============================================================
     VISIBILIDAD DEL CHAT
  ============================================================= */

  function openChat() {
    isOpen = true;
    popup.classList.add('cb-open');
    toggleBtn.classList.add('cb-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function closeChat() {
    isOpen = false;
    popup.classList.remove('cb-open');
    toggleBtn.classList.remove('cb-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      isOpen ? closeChat() : openChat();
    });
  }

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

      addMessage(
        '¡Hola! 👋 Bienvenido a ' + escapeHtml(CONFIG.companyName) +
        '. Soy tu asistente virtual. ¿En qué puedo ayudarte?',
        'in'
      );

      showMainMenu();
      renderAllMessages();
    }, 600);
  })();

})();