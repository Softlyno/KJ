/**
 * @file chatbot.js
 * @description Lógica del chatbot web de KayserBond.
 *
 * IMPORTANTE:
 * - Este archivo contiene únicamente JavaScript.
 * - No agrega HTML ni CSS.
 * - Conserva los IDs y clases que ya usa tu HTML/CSS actual.
 * - Los folios, los turnos de asesores y las notificaciones por WhatsApp
 *   se crean en el NAS mediante la API del bot Baileys.
 *
 * Requiere estos IDs en el HTML existente:
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

    // API del bot Baileys en el NAS para pruebas dentro de la red local.
    // Cuando la página sea pública, cambia esta dirección por el dominio HTTPS
    // configurado en el proxy inverso del NAS.
    apiBaseUrl: 'http://192.168.10.218:3001',

    // Déjalo vacío si tu API no utiliza llave.
    apiKey: '',

    // Ruta del PDF dentro de tu página web.
    catalogUrl: 'catalogo-kayserbond.pdf',

    businessStartHour: 6,
    businessEndHour: 18,
    timeZone: 'America/Mexico_City',

    sessionKey: 'cb_web_session_id',
    apiTimeoutMs: 20000
  };

  var BRANCHES = [
    {
      id: '1',
      name: 'Sucursal El Coecillo',
      address: 'La Luz #317-E. Col. El Coecillo, León, Guanajuato'
    },
    {
      id: '2',
      name: 'Sucursal La Piscina',
      address: 'San Hilario #101 esq San Jacobo. Col. La Piscina, León, Guanajuato'
    }
  ];

  var DEPARTMENTS = {
    PINTURAS_ADHESIVOS: {
      key: 'PINTURAS_ADHESIVOS',
      label: 'Pinturas y recubrimientos / Adhesivos'
    },
    ACABADOS: {
      key: 'ACABADOS',
      label: 'Acabados, cremas, lavadores, igualaciones, etc.'
    }
  };

  /* =============================================================
     ESTADO
  ============================================================= */

  var messages = [];
  var isOpen = false;
  var isSubmitting = false;

  var flow = {
    step: 'menu',
    data: {}
  };

  /* =============================================================
     DOM
  ============================================================= */

  var toggleBtn = document.getElementById('cb-toggle');
  var popup = document.getElementById('cb-popup');
  var msgsEl = document.getElementById('cb-messages');
  var optsEl = document.getElementById('cb-options');

  if (!toggleBtn || !popup || !msgsEl || !optsEl) {
    console.error(
      'KayserBot web: faltan uno o más elementos requeridos: cb-toggle, cb-popup, cb-messages, cb-options.'
    );
    return;
  }

  /* =============================================================
     UTILIDADES
  ============================================================= */

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeText(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeId(value) {
    return String(value || '').trim().toUpperCase();
  }

  function onlyDigits(text) {
    return String(text || '').replace(/\D/g, '');
  }

  function normalizeMexicoPhone(value) {
    var digits = onlyDigits(value);

    if (!digits) return '';

    if (digits.length === 10) {
      return '521' + digits;
    }

    if (digits.length === 11 && digits.charAt(0) === '1') {
      return '52' + digits;
    }

    if (digits.length === 12 && digits.indexOf('52') === 0 && digits.indexOf('521') !== 0) {
      return '521' + digits.slice(2);
    }

    if (digits.length === 13 && digits.indexOf('521') === 0) {
      return digits;
    }

    return '';
  }

  function isLeonCity(city) {
    return normalizeText(city).indexOf('leon') !== -1;
  }

  function parseQuantity(value) {
    var match = String(value || '').match(/\d+/);
    if (!match) return 0;
    return parseInt(match[0], 10) || 0;
  }

  function getCurrentTime() {
    return new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function buildWhatsAppUrl(phone, text) {
    var clean = normalizeMexicoPhone(phone) || onlyDigits(phone);
    return 'https://wa.me/' + clean + '?text=' + encodeURIComponent(text || '');
  }

  function getMexicoHour() {
    try {
      var hour = new Intl.DateTimeFormat('en-US', {
        timeZone: CONFIG.timeZone,
        hour: '2-digit',
        hour12: false
      }).format(new Date());

      return parseInt(hour, 10);
    } catch (error) {
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

  function createSessionId() {
    var existing = localStorage.getItem(CONFIG.sessionKey);
    if (existing) return existing;

    var randomPart = Math.random().toString(36).slice(2, 12);
    var sessionId = 'WEB-' + Date.now() + '-' + randomPart;
    localStorage.setItem(CONFIG.sessionKey, sessionId);
    return sessionId;
  }

  function getSessionId() {
    return createSessionId();
  }

  function resetFlow() {
    flow = {
      step: 'menu',
      data: {}
    };
    isSubmitting = false;
  }

  function clearOptions() {
    optsEl.innerHTML = '';
  }

  function apiUrl(path) {
    return CONFIG.apiBaseUrl.replace(/\/$/, '') + path;
  }

  function apiRequest(path, options) {
    var requestOptions = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, CONFIG.apiTimeoutMs);

    var headers = requestOptions.headers || {};
    headers.Accept = 'application/json';

    if (requestOptions.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (CONFIG.apiKey) {
      headers['X-API-Key'] = CONFIG.apiKey;
    }

    requestOptions.headers = headers;
    requestOptions.signal = controller.signal;

    return fetch(apiUrl(path), requestOptions)
      .then(function (response) {
        return response.text().then(function (rawText) {
          var data = {};

          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch (error) {
            data = { message: rawText };
          }

          if (!response.ok) {
            var message = data.error || data.message || ('Error HTTP ' + response.status);
            throw new Error(message);
          }

          return data;
        });
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  function findProductById(productId) {
    var id = normalizeId(productId);
    return apiRequest('/api/web/product/' + encodeURIComponent(id), {
      method: 'GET'
    }).then(function (response) {
      if (!response || response.ok === false || !response.product) {
        return null;
      }
      return response.product;
    }).catch(function (error) {
      if (
        /no encontrado|not found|404/i.test(String(error && error.message))
      ) {
        return null;
      }
      throw error;
    });
  }

  function createTicket(payload) {
    return apiRequest('/api/web/tickets', {
      method: 'POST',
      body: JSON.stringify({
        source: 'web',
        sessionId: getSessionId(),
        type: payload.type,
        departmentKey: payload.departmentKey,
        customer: payload.customer,
        details: payload.details
      })
    });
  }

  function getAssignedContact(response) {
    if (!response) return null;
    return response.assignedContact || response.assignedPerson || response.contact || null;
  }

  function getTicketId(response) {
    if (!response) return '';
    return response.ticketId || response.folio || response.id || '';
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') {
      return 'Precio no disponible';
    }

    if (typeof value === 'number') {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
      }).format(value);
    }

    var raw = String(value).trim();
    var number = Number(raw.replace(/[$,\s]/g, ''));

    if (!isNaN(number) && /\d/.test(raw)) {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
      }).format(number);
    }

    return raw;
  }

  function normalizeProduct(product) {
    var source = product || {};

    return {
      id: source.id || source.ID || source.productId || '',
      category: source.category || source.categoria || source.Categoria || 'Sin categoría',
      product: source.product || source.producto || source.Producto || source.name || '',
      presentation:
        source.presentation || source.presentacion || source.Presentacion || 'Sin presentación',
      price:
        source.price !== undefined
          ? source.price
          : source.precio !== undefined
            ? source.precio
            : source.Precio,
      departmentKey:
        source.departmentKey || source.department || source.departamento || 'PINTURAS_ADHESIVOS'
    };
  }

  function productDetailsHtml(product) {
    var p = normalizeProduct(product);

    return (
      'ID: <strong>' + escapeHtml(p.id) + '</strong><br>' +
      'Categoría: ' + escapeHtml(p.category) + '<br>' +
      'Producto: ' + escapeHtml(p.product) + '<br>' +
      'Presentación: ' + escapeHtml(p.presentation) + '<br>' +
      'Precio: <strong>' + escapeHtml(formatPrice(p.price)) + '</strong>'
    );
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
    messages = messages.filter(function (message) {
      return message.id !== id;
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
          '<span class="cb-opt-title">Ver catálogo de productos</span>' +
          '<span class="cb-opt-sub">Abrir catálogo PDF</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
        '<span class="cb-opt-icon">💲</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">Consultar precio por ID</span>' +
          '<span class="cb-opt-sub">Consulta la base de productos</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
        '<span class="cb-opt-icon">🛒</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">Hacer pedido</span>' +
          '<span class="cb-opt-sub">Entrega o recolección en sucursal</span>' +
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
        '<input id="cb-text-input" class="cb-text-input" type="text" placeholder="' +
          escapeHtml(placeholder || '') + '" ' +
          'onkeydown="if(event.key===\'Enter\'){cbSubmitText();}">' +
        '<button class="cb-send-btn" onclick="cbSubmitText()">Enviar</button>' +
      '</div>' +
      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';

    setTimeout(function () {
      var input = document.getElementById('cb-text-input');
      if (input) input.focus();
    }, 50);
  }

  function showCatalogOptions() {
    optsEl.innerHTML =
      '<a class="cb-wa-btn" href="' + escapeHtml(CONFIG.catalogUrl) + '" target="_blank" rel="noopener noreferrer">' +
        '📄 Abrir catálogo PDF' +
      '</a>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Consultar precio por ID</span></span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
        '<span class="cb-opt-icon">3️⃣</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Hacer pedido</span></span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'asesoria\')">' +
        '<span class="cb-opt-icon">4️⃣</span>' +
        '<span class="cb-opt-meta"><span class="cb-opt-title">Asesoría técnica</span></span>' +
      '</button>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';
  }

  function showDepartmentOptions() {
    optsEl.innerHTML =
      '<div class="cb-opt-label">Selecciona el departamento:</div>' +

      '<button class="cb-opt-btn" onclick="cbPickDepartment(\'PINTURAS_ADHESIVOS\')">' +
        '<span class="cb-opt-icon">1️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">Pinturas y recubrimientos / Adhesivos</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickDepartment(\'ACABADOS\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">Acabados, cremas, lavadores e igualaciones</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';
  }

  function showBranchOptions(prefix) {
    var html = '';

    if (prefix) {
      html += '<div class="cb-opt-label">' + escapeHtml(prefix) + '</div>';
    }

    for (var i = 0; i < BRANCHES.length; i++) {
      html +=
        '<button class="cb-opt-btn" onclick="cbPickBranch(\'' + BRANCHES[i].id + '\')">' +
          '<span class="cb-opt-icon">' + (i + 1) + '️⃣</span>' +
          '<span class="cb-opt-meta">' +
            '<span class="cb-opt-title">' + escapeHtml(BRANCHES[i].name) + '</span>' +
            '<span class="cb-opt-sub">' + escapeHtml(BRANCHES[i].address) + '</span>' +
          '</span>' +
        '</button>';
    }

    html += '<button class="cb-back-btn" onclick="cbCancelFlow()">Cancelar</button>';
    optsEl.innerHTML = html;
  }

  function showWhatsAppPanel(agent, ticketId) {
    if (!agent || !agent.phone) {
      optsEl.innerHTML =
        '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú principal</button>';
      return;
    }

    var waText = 'Hola, mi folio es ' + ticketId + '.';

    optsEl.innerHTML =
      '<div class="cb-agent-card">' +
        '<div class="cb-agent-name">' + escapeHtml(agent.name || 'Contacto asignado') + '</div>' +
        '<div class="cb-agent-role">' + escapeHtml(agent.role || agent.label || 'Atención KayserBond') + '</div>' +
        '<div class="cb-badge">📋 Atención por WhatsApp</div>' +
      '</div>' +

      '<a class="cb-wa-btn" href="' + buildWhatsAppUrl(agent.phone, waText) + '" target="_blank" rel="noopener noreferrer">' +
        'Abrir WhatsApp con ' + escapeHtml(agent.name || 'el contacto asignado') +
      '</a>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú principal</button>';
  }

  function setControlsDisabled(disabled) {
    var controls = optsEl.querySelectorAll('button, input, a');
    for (var i = 0; i < controls.length; i++) {
      if ('disabled' in controls[i]) {
        controls[i].disabled = disabled;
      }
    }
  }

  /* =============================================================
     FINALIZACIÓN Y TICKETS
  ============================================================= */

  function finishWithTicket(payload, successMessage) {
    if (isSubmitting) return;

    isSubmitting = true;
    setControlsDisabled(true);
    clearOptions();

    var typingId = showTyping();

    createTicket(payload)
      .then(function (response) {
        removeTyping(typingId);

        var ticketId = getTicketId(response);
        var assignedContact = getAssignedContact(response);

        if (!ticketId) {
          throw new Error('El NAS no devolvió el folio del ticket.');
        }

        addMessage(
          escapeHtml(successMessage) + '<br><br>' +
          'Tu folio es: <strong>' + escapeHtml(ticketId) + '</strong><br><br>' +
          'El caso fue enviado al contacto correspondiente por WhatsApp.',
          'in'
        );

        flow.step = 'finished';
        flow.data.ticketId = ticketId;
        flow.data.assignedContact = assignedContact;
        isSubmitting = false;

        showWhatsAppPanel(assignedContact, ticketId);
      })
      .catch(function (error) {
        removeTyping(typingId);
        isSubmitting = false;

        addMessage(
          'No pude registrar el caso en el NAS.<br><br>' +
          'Detalle: ' + escapeHtml(error.message || String(error)) + '<br><br>' +
          'Tus datos siguen en el formulario. Puedes intentar nuevamente.',
          'in'
        );

        optsEl.innerHTML =
          '<button class="cb-opt-btn" onclick="cbRetryTicket()">' +
            '<span class="cb-opt-icon">🔄</span>' +
            '<span class="cb-opt-meta"><span class="cb-opt-title">Intentar nuevamente</span></span>' +
          '</button>' +
          '<button class="cb-back-btn" onclick="cbGoBack()">← Volver al menú</button>';
      });
  }

  function buildOrderTicketPayload() {
    var d = flow.data;

    return {
      type: 'pedido',
      departmentKey: 'PEDIDOS',
      customer: {
        name: d.name,
        phone: d.phone,
        city: d.city,
        source: 'web'
      },
      details: {
        productId: d.productId,
        product: d.product,
        quantity: d.quantity,
        deliveryType: d.deliveryType,
        address: d.address || '',
        branchId: d.branchId || '',
        branchName: d.branchName || ''
      }
    };
  }

  function buildTechnicalTicketPayload() {
    var d = flow.data;

    return {
      type: 'asesoria_tecnica',
      departmentKey: d.departmentKey,
      customer: {
        name: d.name,
        phone: d.phone,
        source: 'web'
      },
      details: {
        materials: d.material,
        conditions: d.conditions,
        goal: d.goal
      }
    };
  }

  /* =============================================================
     FLUJOS
  ============================================================= */

  window.cbPickMenu = function (option) {
    var labels = {
      catalogo: 'Ver catálogo de productos',
      precios: 'Consultar precio por ID',
      pedido: 'Hacer pedido',
      asesoria: 'Asesoría técnica'
    };

    addMessage(escapeHtml(labels[option] || option), 'out');
    clearOptions();

    if (!isBusinessHours()) {
      addMessage(
        'Aviso: nuestro horario de atención es de ' + businessHoursText() +
        '. Aun así puedes dejar tus datos y se dará seguimiento.',
        'in'
      );
    }

    if (option === 'catalogo') {
      resetFlow();

      botReply(
        'Claro ✅<br><br>' +
        'Te voy a mostrar el catálogo PDF. Puede tardar un poco.<br><br>' +
        'Después puedes elegir consultar precio por ID, hacer pedido o solicitar asesoría técnica.',
        showCatalogOptions
      );
      return;
    }

    if (option === 'precios') {
      flow.step = 'price_id';
      flow.data = {};

      botReply('Por favor escribe el ID del producto que quieres consultar.', function () {
        showTextInput('ID del producto', 'Ejemplo: PINT-001');
      });
      return;
    }

    if (option === 'pedido') {
      flow.step = 'order_name';
      flow.data = {};

      botReply('¡Perfecto! Vamos a registrar tu pedido.', function () {
        showTextInput('¿Cuál es tu nombre?', 'Escribe tu nombre');
      });
      return;
    }

    if (option === 'asesoria') {
      flow.step = 'tech_department';
      flow.data = {};

      botReply('Selecciona el departamento que corresponde a tu solicitud.', showDepartmentOptions);
    }
  };

  window.cbSubmitText = function () {
    var input = document.getElementById('cb-text-input');
    if (!input || isSubmitting) return;

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
      apiRequest('/health', { method: 'GET' })
        .then(function (response) {
          botReply(
            '✅ El chatbot web y el NAS están respondiendo.<br><br>' +
            'Estado: ' + escapeHtml(response.status || 'activo'),
            showMainMenu
          );
        })
        .catch(function () {
          botReply(
            'El chatbot web funciona, pero no pude comunicarme con el NAS.',
            showMainMenu
          );
        });
      return;
    }

    switch (flow.step) {
      case 'price_id':
        var requestedId = normalizeId(value);
        var typingId = showTyping();

        findProductById(requestedId)
          .then(function (product) {
            removeTyping(typingId);

            if (!product) {
              botReply(
                'Lo siento, no encontré ese producto en la base de precios.<br><br>' +
                'Verifica que el ID esté escrito correctamente.<br>' +
                'Ejemplo: PINT-001',
                function () {
                  showTextInput('ID del producto', 'Ejemplo: PINT-001');
                }
              );
              return;
            }

            var normalizedProduct = normalizeProduct(product);
            flow.data.productId = normalizedProduct.id;
            flow.data.product = normalizedProduct;
            flow.step = 'menu';

            botReply(
              'Producto encontrado ✅<br><br>' +
              productDetailsHtml(normalizedProduct) + '<br><br>' +
              'Si deseas hacer pedido, selecciona la opción 3.',
              showMainMenu
            );
          })
          .catch(function (error) {
            removeTyping(typingId);
            botReply(
              'No pude consultar la base de precios del NAS.<br><br>' +
              'Detalle: ' + escapeHtml(error.message || String(error)),
              function () {
                showTextInput('ID del producto', 'Ejemplo: PINT-001');
              }
            );
          });
        break;

      case 'order_name':
        flow.data.name = value;
        flow.step = 'order_phone';

        botReply('Gracias, ' + escapeHtml(value) + '.', function () {
          showTextInput('¿Cuál es tu número de WhatsApp?', 'Ejemplo: 4771287534');
        });
        break;

      case 'order_phone':
        var orderPhone = normalizeMexicoPhone(value);

        if (!orderPhone) {
          botReply('No entendí el número. Escríbelo con 10 dígitos.', function () {
            showTextInput('¿Cuál es tu número de WhatsApp?', 'Ejemplo: 4771287534');
          });
          return;
        }

        flow.data.phone = orderPhone;
        flow.step = 'order_city';

        botReply('Gracias. Nos encontramos en León, Guanajuato.', function () {
          showTextInput('¿En qué ciudad te encuentras?', 'Ejemplo: León, Guanajuato');
        });
        break;

      case 'order_city':
        flow.data.city = value;
        flow.step = 'order_product_id';

        botReply('Gracias.', function () {
          showTextInput('Escribe el ID del producto que deseas', 'Ejemplo: PINT-001');
        });
        break;

      case 'order_product_id':
        var orderProductId = normalizeId(value);
        var orderTypingId = showTyping();

        findProductById(orderProductId)
          .then(function (product) {
            removeTyping(orderTypingId);

            if (!product) {
              botReply(
                'Lo siento, no encontré ese producto en la base de precios.<br><br>' +
                'Verifica el ID e inténtalo nuevamente.',
                function () {
                  showTextInput('ID del producto', 'Ejemplo: PINT-001');
                }
              );
              return;
            }

            var normalizedProduct = normalizeProduct(product);
            flow.data.productId = normalizedProduct.id;
            flow.data.product = normalizedProduct;
            flow.step = 'order_quantity';

            botReply(
              'Producto seleccionado ✅<br><br>' +
              productDetailsHtml(normalizedProduct),
              function () {
                showTextInput('¿Qué cantidad necesitas?', 'Ejemplo: 6');
              }
            );
          })
          .catch(function (error) {
            removeTyping(orderTypingId);
            botReply(
              'No pude consultar la base de productos del NAS.<br><br>' +
              escapeHtml(error.message || String(error)),
              function () {
                showTextInput('ID del producto', 'Ejemplo: PINT-001');
              }
            );
          });
        break;

      case 'order_quantity':
        var quantity = parseQuantity(value);

        if (!quantity) {
          botReply('Escribe una cantidad válida usando números.', function () {
            showTextInput('¿Qué cantidad necesitas?', 'Ejemplo: 6');
          });
          return;
        }

        flow.data.quantity = quantity;

        if (quantity >= 5 && isLeonCity(flow.data.city)) {
          flow.data.deliveryType = 'Entrega a domicilio en León';
          flow.step = 'order_address';

          botReply(
            'Como tu pedido es de ' + quantity +
            ' piezas y estás en León, podemos revisar entrega a domicilio.',
            function () {
              showTextInput('Escribe tu dirección completa', 'Calle, número, colonia y referencias');
            }
          );
          return;
        }

        flow.data.deliveryType = 'Recoge/compra en sucursal';
        flow.step = 'order_branch';

        if (quantity >= 5 && !isLeonCity(flow.data.city)) {
          botReply(
            'Por ahora la entrega a domicilio aplica solamente en León, Guanajuato.',
            function () {
              showBranchOptions('Selecciona la sucursal donde deseas comprar o recoger:');
            }
          );
          return;
        }

        botReply(
          'Para pedidos menores a 5 piezas puedes acudir a una de nuestras sucursales.',
          function () {
            showBranchOptions('Selecciona la sucursal donde deseas comprar o recoger:');
          }
        );
        break;

      case 'order_address':
        flow.data.address = value;
        finishWithTicket(
          buildOrderTicketPayload(),
          '¡Gracias! Ya registré tu pedido con entrega a domicilio.'
        );
        break;

      case 'tech_name':
        flow.data.name = value;
        flow.step = 'tech_phone';

        botReply('Gracias, ' + escapeHtml(value) + '.', function () {
          showTextInput('¿Cuál es tu número de WhatsApp?', 'Ejemplo: 4771287534');
        });
        break;

      case 'tech_phone':
        var techPhone = normalizeMexicoPhone(value);

        if (!techPhone) {
          botReply('No entendí el número. Escríbelo con 10 dígitos.', function () {
            showTextInput('¿Cuál es tu número de WhatsApp?', 'Ejemplo: 4771287534');
          });
          return;
        }

        flow.data.phone = techPhone;
        flow.step = 'tech_material';

        botReply('Gracias.', function () {
          showTextInput(
            '¿Qué materiales vas a pegar, unir, sellar, pintar o trabajar?',
            'Ejemplo: piel con hule, madera con tela'
          );
        });
        break;

      case 'tech_material':
        flow.data.material = value;
        flow.step = 'tech_conditions';

        botReply('Entendido.', function () {
          showTextInput(
            '¿En qué condiciones se usará el producto?',
            'Ejemplo: calor, humedad, agua, sol o fricción'
          );
        });
        break;

      case 'tech_conditions':
        flow.data.conditions = value;
        flow.step = 'tech_goal';

        botReply('Perfecto.', function () {
          showTextInput(
            '¿Qué necesitas que logre el producto?',
            'Ejemplo: pegar fuerte, secar rápido o resistir calor'
          );
        });
        break;

      case 'tech_goal':
        flow.data.goal = value;
        finishWithTicket(
          buildTechnicalTicketPayload(),
          'Gracias ✅ Ya levanté tu ficha básica de asesoría técnica.'
        );
        break;

      default:
        resetFlow();
        botReply('No entendí tu respuesta. Te muestro el menú principal.', showMainMenu);
        break;
    }
  }

  window.cbPickDepartment = function (departmentKey) {
    var department = DEPARTMENTS[departmentKey];

    if (!department) {
      botReply('No reconocí el departamento.', showDepartmentOptions);
      return;
    }

    addMessage(escapeHtml(department.label), 'out');
    clearOptions();

    flow.data.departmentKey = department.key;
    flow.step = 'tech_name';

    botReply('Perfecto. Vamos a levantar una ficha básica de asesoría técnica.', function () {
      showTextInput('¿Cuál es tu nombre?', 'Escribe tu nombre');
    });
  };

  window.cbPickBranch = function (branchId) {
    var branch = null;

    for (var i = 0; i < BRANCHES.length; i++) {
      if (BRANCHES[i].id === String(branchId)) {
        branch = BRANCHES[i];
        break;
      }
    }

    if (!branch) {
      botReply('No encontré esa sucursal.', function () {
        showBranchOptions('Selecciona una sucursal:');
      });
      return;
    }

    addMessage(escapeHtml(branch.name), 'out');
    clearOptions();

    flow.data.branchId = branch.id;
    flow.data.branchName = branch.name + ' - ' + branch.address;
    flow.data.deliveryType = 'Recoge/compra en ' + branch.name;

    finishWithTicket(
      buildOrderTicketPayload(),
      '¡Gracias! Ya registré tu pedido para recoger o comprar en ' + branch.name + '.'
    );
  };

  window.cbRetryTicket = function () {
    if (flow.data && flow.data.departmentKey && flow.data.material) {
      finishWithTicket(
        buildTechnicalTicketPayload(),
        'Gracias ✅ Ya levanté tu ficha básica de asesoría técnica.'
      );
      return;
    }

    finishWithTicket(
      buildOrderTicketPayload(),
      '¡Gracias! Ya registré tu pedido.'
    );
  };

  window.cbCancelFlow = function () {
    addMessage('Cancelar', 'out');
    resetFlow();
    botReply('Proceso cancelado. Volvemos al menú principal.', showMainMenu);
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

  toggleBtn.addEventListener('click', function () {
    isOpen ? closeChat() : openChat();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isOpen) closeChat();
  });

  /* =============================================================
     INICIALIZACIÓN
  ============================================================= */

  (function init() {
    createSessionId();

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