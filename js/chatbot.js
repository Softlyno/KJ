/**
 * @file chatbot.js
 * @description Chatbot web de KayserBond conectado al NAS.
 *
 * El catálogo PDF se abre directamente desde la página web.
 * Los precios, pedidos, folios y asesorías se consultan en el NAS.
 *
 * Requiere estos IDs en el HTML:
 * - cb-toggle
 * - cb-popup
 * - cb-messages
 * - cb-options
 */

(function () {
  'use strict';

  /* =========================================================
     CONFIGURACIÓN
  ========================================================= */

  var CONFIG = {
    companyName: 'KayserBond',

    apiBaseUrl:
      window.KAYSERBOT_API_BASE ||
      'https://progress-scariness-ripple.ngrok-free.dev',

    // El PDF está en la raíz del repositorio, junto a index.html.
    catalogUrl:
      window.location.origin +
      '/catalogo-kayserbond.pdf',

    businessStartHour: 6,
    businessEndHour: 18,
    timeZone: 'America/Mexico_City',

    sessionKey: 'kayserbot_web_session_id',
    requestTimeoutMs: 30000
  };

  var BRANCHES_FALLBACK = [
    {
      id: '1',
      name: 'Sucursal El Coecillo',
      address:
        'La Luz #317-E. Col. El Coecillo, León, Guanajuato'
    },
    {
      id: '2',
      name: 'Sucursal La Piscina',
      address:
        'San Hilario #101 esq. San Jacobo. Col. La Piscina, León, Guanajuato'
    }
  ];

  var DEPARTMENTS = {
    PINTURAS_ADHESIVOS: {
      key: 'PINTURAS_ADHESIVOS',
      label: 'Pinturas, recubrimientos y adhesivos'
    },

    ACABADOS: {
      key: 'ACABADOS',
      label:
        'Acabados, cremas, lavadores e igualaciones'
    }
  };

  /* =========================================================
     ESTADO
  ========================================================= */

  var messages = [];
  var isOpen = false;
  var isSubmitting = false;
  var serverConfig = null;
  var paintProducts = [];
  var memorySessionId = '';

  var flow = {
    step: 'menu',
    data: {},
    requestId: ''
  };

  /* =========================================================
     ELEMENTOS DEL HTML
  ========================================================= */

  var toggleBtn =
    document.getElementById('cb-toggle');

  var popup =
    document.getElementById('cb-popup');

  var msgsEl =
    document.getElementById('cb-messages');

  var optsEl =
    document.getElementById('cb-options');

  if (
    !toggleBtn ||
    !popup ||
    !msgsEl ||
    !optsEl
  ) {
    console.error(
      'KayserBot web: faltan cb-toggle, cb-popup, cb-messages o cb-options.'
    );

    return;
  }

  /* =========================================================
     UTILIDADES
  ========================================================= */

  function escapeHtml(value) {
    return String(
      value === undefined ||
      value === null
        ? ''
        : value
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function onlyDigits(value) {
    return String(value || '')
      .replace(/\D/g, '');
  }

  function normalizeMexicoPhone(value) {
    var digits = onlyDigits(value);

    if (!digits) {
      return '';
    }

    if (digits.length === 10) {
      return '521' + digits;
    }

    if (
      digits.length === 11 &&
      digits.charAt(0) === '1'
    ) {
      return '52' + digits;
    }

    if (
      digits.length === 12 &&
      digits.indexOf('52') === 0 &&
      digits.indexOf('521') !== 0
    ) {
      return '521' + digits.slice(2);
    }

    if (
      digits.length === 13 &&
      digits.indexOf('521') === 0
    ) {
      return digits;
    }

    return '';
  }

  function parseQuantity(value) {
    var match =
      String(value || '').match(/\d+/);

    if (!match) {
      return 0;
    }

    return parseInt(match[0], 10) || 0;
  }

  function isLeonCity(city) {
    return normalizeText(city)
      .indexOf('leon') !== -1;
  }

  function getCurrentTime() {
    return new Date()
      .toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit'
      });
  }

  function getMexicoHour() {
    try {
      return parseInt(
        new Intl.DateTimeFormat(
          'en-US',
          {
            timeZone: CONFIG.timeZone,
            hour: '2-digit',
            hour12: false
          }
        ).format(new Date()),
        10
      );
    } catch (error) {
      return new Date().getHours();
    }
  }

  function isBusinessHours() {
    var hour = getMexicoHour();

    return (
      hour >= CONFIG.businessStartHour &&
      hour < CONFIG.businessEndHour
    );
  }

  function businessHoursText() {
    return '6:00 AM a 6:00 PM';
  }

  function createUniqueId(prefix) {
    return (
      prefix +
      '-' +
      Date.now() +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 12)
    );
  }

  function getSessionId() {
    try {
      var saved =
        localStorage.getItem(
          CONFIG.sessionKey
        );

      if (saved) {
        return saved;
      }

      var created =
        createUniqueId('WEB');

      localStorage.setItem(
        CONFIG.sessionKey,
        created
      );

      return created;
    } catch (error) {
      if (!memorySessionId) {
        memorySessionId =
          createUniqueId('WEB');
      }

      return memorySessionId;
    }
  }

  function ensureRequestId(prefix) {
    if (!flow.requestId) {
      flow.requestId =
        createUniqueId(prefix);
    }

    return flow.requestId;
  }

  function resetFlow() {
    flow = {
      step: 'menu',
      data: {},
      requestId: ''
    };

    isSubmitting = false;
  }

  function clearOptions() {
    optsEl.innerHTML = '';
  }

  function getBranches() {
    if (
      serverConfig &&
      Array.isArray(
        serverConfig.branches
      ) &&
      serverConfig.branches.length > 0
    ) {
      return serverConfig.branches;
    }

    return BRANCHES_FALLBACK;
  }

  function apiUrl(path) {
    return (
      CONFIG.apiBaseUrl
        .replace(/\/$/, '') +
      path
    );
  }

  /* =========================================================
     CONEXIÓN CON EL NAS
  ========================================================= */

  function apiRequest(path, options) {
    var requestOptions =
      options || {};

    var controller =
      new AbortController();

    var timeout =
      setTimeout(function () {
        controller.abort();
      }, CONFIG.requestTimeoutMs);

    requestOptions.headers =
      Object.assign(
        {
          Accept: 'application/json',

          // Evita la advertencia del plan gratuito de ngrok.
          'ngrok-skip-browser-warning': '1'
        },
        requestOptions.headers || {}
      );

    if (requestOptions.body) {
      requestOptions.headers[
        'Content-Type'
      ] = 'application/json';
    }

    requestOptions.signal =
      controller.signal;

    requestOptions.cache =
      'no-store';

    return fetch(
      apiUrl(path),
      requestOptions
    )
      .then(function (response) {
        return response
          .text()
          .then(function (rawText) {
            var payload = {};

            try {
              payload = rawText
                ? JSON.parse(rawText)
                : {};
            } catch (error) {
              payload = {
                message: rawText
              };
            }

            if (!response.ok) {
              var errorCode =
                payload.error ||
                payload.message ||
                (
                  'HTTP_' +
                  response.status
                );

              var requestError =
                new Error(errorCode);

              requestError.status =
                response.status;

              throw requestError;
            }

            return payload;
          });
      })
      .catch(function (error) {
        if (
          error &&
          error.name === 'AbortError'
        ) {
          throw new Error(
            'REQUEST_TIMEOUT'
          );
        }

        throw error;
      })
      .finally(function () {
        clearTimeout(timeout);
      });
  }

  function initializeServerConnection() {
    return apiRequest(
      '/api/web/config',
      {
        method: 'GET'
      }
    )
      .then(function (config) {
        serverConfig = config;

        if (
          config &&
          config.companyName
        ) {
          CONFIG.companyName =
            config.companyName;
        }

        return config;
      })
      .catch(function (error) {
        console.error(
          'KayserBot web: no se pudo conectar inicialmente con el NAS:',
          error
        );

        return null;
      });
  }

  function lookupProduct(query) {
    var cleanQuery =
      String(query || '').trim();

    return apiRequest(
      '/api/web/product/' +
        encodeURIComponent(cleanQuery),
      {
        method: 'GET'
      }
    ).then(function (response) {
      if (
        !response ||
        !response.product
      ) {
        throw new Error(
          'PRODUCT_NOT_FOUND'
        );
      }

      return normalizeProduct(
        response.product
      );
    });
  }

  function loadPaintProducts() {
    return apiRequest(
      '/api/web/paints',
      {
        method: 'GET'
      }
    ).then(function (response) {
      var products =
        response &&
        Array.isArray(
          response.products
        )
          ? response.products
          : [];

      paintProducts =
        products.map(
          normalizeProduct
        );

      return paintProducts;
    });
  }

  function getCatalogUrl() {
    return CONFIG.catalogUrl;
  }

  /* =========================================================
     PRODUCTOS
  ========================================================= */

  function normalizeProduct(product) {
    var source = product || {};

    return {
      id:
        source.id ||
        source.ID ||
        source.productId ||
        '',

      category:
        source.category ||
        source.categoria ||
        source.Categoria ||
        'Sin categoría',

      product:
        source.product ||
        source.producto ||
        source.Producto ||
        source.name ||
        '',

      presentation:
        source.presentation ||
        source.presentacion ||
        source.Presentacion ||
        'Sin presentación registrada',

      price:
        source.price !== undefined
          ? source.price
          : source.precio !== undefined
            ? source.precio
            : source.Precio,

      formattedPrice:
        source.formattedPrice ||
        source.formatted_price ||
        '',

      departmentKey:
        source.departmentKey ||
        source.department ||
        source.departamento ||
        'PINTURAS_ADHESIVOS',

      variants:
        Array.isArray(source.variants)
          ? source.variants
          : [],

      notes:
        Array.isArray(source.notes)
          ? source.notes
          : []
    };
  }

  function formatMoney(value) {
    var numeric = Number(value);

    if (
      !isFinite(numeric) ||
      numeric <= 0
    ) {
      return 'Precio no disponible';
    }

    return new Intl.NumberFormat(
      'es-MX',
      {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    ).format(numeric);
  }

  function productDetailsHtml(product) {
    var p =
      normalizeProduct(product);

    var html =
      'Clave: <strong>' +
      escapeHtml(p.id) +
      '</strong><br>' +

      'Producto: ' +
      escapeHtml(p.product) +
      '<br>' +

      'Categoría: ' +
      escapeHtml(p.category);

    if (p.variants.length > 0) {
      html +=
        '<br><br><strong>' +
        'Precios de venta al público:' +
        '</strong>';

      for (
        var i = 0;
        i < p.variants.length;
        i++
      ) {
        html +=
          '<br>• ' +
          escapeHtml(
            p.variants[i]
              .presentation ||
            'Presentación'
          ) +
          ': <strong>' +
          escapeHtml(
            formatMoney(
              p.variants[i].price
            )
          ) +
          '</strong>';
      }
    } else {
      html +=
        '<br><br><strong>' +
        escapeHtml(
          p.formattedPrice ||
          p.price ||
          'Precio no disponible'
        ) +
        '</strong>';
    }

    if (p.notes.length > 0) {
      html +=
        '<br><br><strong>' +
        'Notas:' +
        '</strong>';

      for (
        var n = 0;
        n < p.notes.length;
        n++
      ) {
        html +=
          '<br>• ' +
          escapeHtml(p.notes[n]);
      }
    }

    return html;
  }

  /* =========================================================
     MENSAJES
  ========================================================= */

  function renderMessage(message) {
    if (message.type === 'typing') {
      return (
        '<div class="cb-msg in">' +
          '<div class="cb-typing">' +
            '<div class="cb-dot"></div>' +
            '<div class="cb-dot"></div>' +
            '<div class="cb-dot"></div>' +
          '</div>' +
        '</div>'
      );
    }

    var side =
      message.direction === 'out'
        ? 'out'
        : 'in';

    return (
      '<div class="cb-msg ' +
      side +
      '">' +

        message.html +

        '<div class="cb-msg-time">' +
          message.time +
        '</div>' +

      '</div>'
    );
  }

  function renderAllMessages() {
    msgsEl.innerHTML =
      messages
        .map(renderMessage)
        .join('');

    msgsEl.scrollTop =
      msgsEl.scrollHeight;
  }

  function addMessage(
    html,
    direction
  ) {
    messages.push({
      html: html,
      direction: direction,
      time: getCurrentTime()
    });

    renderAllMessages();
  }

  function showTyping() {
    var typingId =
      Date.now() +
      Math.floor(
        Math.random() * 999
      );

    messages.push({
      type: 'typing',
      id: typingId
    });

    renderAllMessages();

    return typingId;
  }

  function removeTyping(typingId) {
    messages =
      messages.filter(
        function (message) {
          return (
            message.id !== typingId
          );
        }
      );

    renderAllMessages();
  }

  function botReply(
    html,
    callback
  ) {
    clearOptions();

    var typingId =
      showTyping();

    setTimeout(function () {
      removeTyping(typingId);

      addMessage(
        html,
        'in'
      );

      if (
        typeof callback ===
        'function'
      ) {
        callback();
      }

      renderAllMessages();
    }, 450);
  }

  /* =========================================================
     MENÚ PRINCIPAL
  ========================================================= */

  function showMainMenu() {
    optsEl.innerHTML =
      '<div class="cb-opt-label">' +
        'Selecciona una opción:' +
      '</div>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'catalogo\')">' +
        '<span class="cb-opt-icon">1️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Ver catálogo de productos' +
          '</span>' +
          '<span class="cb-opt-sub">' +
            'Abrir catálogo PDF' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Consultar precio con clave' +
          '</span>' +
          '<span class="cb-opt-sub">' +
            'Buscar por clave o nombre' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
        '<span class="cb-opt-icon">3️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Hacer pedido' +
          '</span>' +
          '<span class="cb-opt-sub">' +
            'Entrega o recolección' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'asesoria\')">' +
        '<span class="cb-opt-icon">4️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Asesoría técnica' +
          '</span>' +
          '<span class="cb-opt-sub">' +
            'Materiales, condiciones y objetivo' +
          '</span>' +
        '</span>' +
      '</button>';
  }

  function showTextInput(
    label,
    placeholder
  ) {
    optsEl.innerHTML =
      '<div class="cb-opt-label">' +
        escapeHtml(label) +
      '</div>' +

      '<div class="cb-input-wrap">' +

        '<input ' +
          'id="cb-text-input" ' +
          'class="cb-text-input" ' +
          'type="text" ' +
          'autocomplete="off" ' +
          'placeholder="' +
            escapeHtml(
              placeholder || ''
            ) +
          '" ' +
          'onkeydown="' +
            'if(event.key===\'Enter\'){' +
              'cbSubmitText();' +
            '}' +
          '">' +

        '<button ' +
          'class="cb-send-btn" ' +
          'onclick="cbSubmitText()">' +
          'Enviar' +
        '</button>' +

      '</div>' +

      '<button ' +
        'class="cb-back-btn" ' +
        'onclick="cbGoBack()">' +
        '← Volver al menú' +
      '</button>';

    setTimeout(function () {
      var input =
        document.getElementById(
          'cb-text-input'
        );

      if (input) {
        input.focus();
      }
    }, 50);
  }

  /* =========================================================
     CATÁLOGO LOCAL
  ========================================================= */

  function showCatalogOptions() {
    optsEl.innerHTML =
      '<a ' +
        'class="cb-wa-btn" ' +
        'href="' +
          escapeHtml(
            getCatalogUrl()
          ) +
        '" ' +
        'target="_blank" ' +
        'rel="noopener noreferrer">' +

        '📄 Abrir catálogo PDF' +

      '</a>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'precios\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Consultar precio con clave' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'pedido\')">' +
        '<span class="cb-opt-icon">3️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Hacer pedido' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickMenu(\'asesoria\')">' +
        '<span class="cb-opt-icon">4️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Asesoría técnica' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">' +
        '← Volver al menú' +
      '</button>';
  }

  /* =========================================================
     CONSULTA DE PRECIOS
  ========================================================= */

  function showPriceSearchMode() {
    optsEl.innerHTML =
      '<div class="cb-opt-label">' +
        '¿Cómo deseas consultar el precio?' +
      '</div>' +

      '<button class="cb-opt-btn" onclick="cbChoosePriceMode(\'search\')">' +
        '<span class="cb-opt-icon">1️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Buscar por clave o nombre' +
          '</span>' +
          '<span class="cb-opt-sub">' +
            'Ejemplo: KPU-101 o CK-314' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbChoosePriceMode(\'paints\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Ver todas las pinturas e impermeabilizantes' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">' +
        '← Volver al menú' +
      '</button>';
  }

  function showPaintOptions(products) {
    var html =
      '<div class="cb-opt-label">' +
        'Selecciona la pintura:' +
      '</div>';

    for (
      var i = 0;
      i < products.length;
      i++
    ) {
      html +=
        '<button ' +
          'class="cb-opt-btn" ' +
          'onclick="cbPickPaint(' +
            i +
          ')">' +

          '<span class="cb-opt-icon">' +
            String(i + 1) +
          '</span>' +

          '<span class="cb-opt-meta">' +

            '<span class="cb-opt-title">' +
              escapeHtml(
                products[i].product
              ) +
            '</span>' +

            '<span class="cb-opt-sub">' +
              escapeHtml(
                products[i].id
              ) +
            '</span>' +

          '</span>' +

        '</button>';
    }

    html +=
      '<button class="cb-back-btn" onclick="cbGoBack()">' +
        '← Volver al menú' +
      '</button>';

    optsEl.innerHTML = html;
  }

  function loadAndShowPaints(purpose) {
    clearOptions();

    var typingId =
      showTyping();

    loadPaintProducts()
      .then(function (products) {
        removeTyping(typingId);

        if (!products.length) {
          throw new Error(
            'PAINT_LIST_EMPTY'
          );
        }

        flow.step =
          purpose === 'order'
            ? 'order_paint_choice'
            : 'price_paint_choice';

        addMessage(
          'Pinturas e impermeabilizantes disponibles ✅<br><br>' +
          'Selecciona una opción para consultar sus presentaciones y precios.',
          'in'
        );

        showPaintOptions(products);
      })
      .catch(function (error) {
        removeTyping(typingId);

        botReply(
          'No pude cargar la lista de pinturas desde el NAS.<br><br>' +
          escapeHtml(
            friendlyError(error)
          ),
          function () {
            if (purpose === 'order') {
              flow.step =
                'order_product_query';

              showTextInput(
                'Clave o nombre del producto',
                'Ejemplo: KPU-101'
              );
            } else {
              flow.step =
                'price_product_query';

              showTextInput(
                'Clave o nombre del producto',
                'Ejemplo: KIM-001'
              );
            }
          }
        );
      });
  }

  function selectPriceProduct(product) {
    var normalized =
      normalizeProduct(product);

    flow.data.product =
      normalized;

    flow.step = 'menu';

    botReply(
      'Producto encontrado ✅<br><br>' +
      productDetailsHtml(normalized) +
      '<br><br>' +
      'Si deseas hacer pedido, selecciona la opción 3.',
      showMainMenu
    );
  }

  function selectOrderProduct(product) {
    var normalized =
      normalizeProduct(product);

    flow.data.product =
      normalized;

    flow.data.productId =
      normalized.id;

    flow.data.productQuery =
      normalized.product ||
      normalized.id;

    flow.step =
      'order_quantity';

    botReply(
      'Producto seleccionado ✅<br><br>' +
      productDetailsHtml(normalized),
      function () {
        showTextInput(
          '¿Qué cantidad necesitas?',
          'Ejemplo: 5'
        );
      }
    );
  }

  function searchPriceProduct(query) {
    clearOptions();

    var typingId =
      showTyping();

    lookupProduct(query)
      .then(function (product) {
        removeTyping(typingId);

        selectPriceProduct(product);
      })
      .catch(function (error) {
        removeTyping(typingId);

        botReply(
          'No encontré ese producto en la lista de precios 2026.<br><br>' +
          'Puedes escribir la clave o una parte del nombre.<br><br>' +
          'Ejemplos:<br>' +
          '• KPU-101<br>' +
          '• KIM-001<br>' +
          '• ACRILEST MATE<br>' +
          '• CK-314<br><br>' +
          'También puedes escribir pinturas.',
          function () {
            flow.step =
              'price_product_query';

            showTextInput(
              'Clave o nombre',
              'Ejemplo: KPU-101'
            );
          }
        );
      });
  }

  function searchOrderProduct(query) {
    clearOptions();

    var typingId =
      showTyping();

    lookupProduct(query)
      .then(function (product) {
        removeTyping(typingId);

        selectOrderProduct(product);
      })
      .catch(function () {
        removeTyping(typingId);

        botReply(
          'No encontré ese producto en la lista de precios 2026.<br><br>' +
          'Puedes escribir una clave, una parte del nombre o pinturas.',
          function () {
            flow.step =
              'order_product_query';

            showTextInput(
              'Clave o nombre',
              'Ejemplo: CK-314'
            );
          }
        );
      });
  }

  /* =========================================================
     DEPARTAMENTOS Y SUCURSALES
  ========================================================= */

  function showDepartmentOptions() {
    optsEl.innerHTML =
      '<div class="cb-opt-label">' +
        'Selecciona el departamento:' +
      '</div>' +

      '<button class="cb-opt-btn" onclick="cbPickDepartment(\'PINTURAS_ADHESIVOS\')">' +
        '<span class="cb-opt-icon">1️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Pinturas, recubrimientos y adhesivos' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-opt-btn" onclick="cbPickDepartment(\'ACABADOS\')">' +
        '<span class="cb-opt-icon">2️⃣</span>' +
        '<span class="cb-opt-meta">' +
          '<span class="cb-opt-title">' +
            'Acabados, cremas, lavadores e igualaciones' +
          '</span>' +
        '</span>' +
      '</button>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">' +
        '← Volver al menú' +
      '</button>';
  }

  function showBranchOptions(prefix) {
    var branches =
      getBranches();

    var html =
      '<div class="cb-opt-label">' +
        escapeHtml(
          prefix ||
          'Selecciona una sucursal:'
        ) +
      '</div>';

    for (
      var i = 0;
      i < branches.length;
      i++
    ) {
      html +=
        '<button ' +
          'class="cb-opt-btn" ' +
          'onclick="cbPickBranch(\'' +
            escapeHtml(
              branches[i].id
            ) +
          '\')">' +

          '<span class="cb-opt-icon">' +
            String(i + 1) +
            '️⃣' +
          '</span>' +

          '<span class="cb-opt-meta">' +

            '<span class="cb-opt-title">' +
              escapeHtml(
                branches[i].name
              ) +
            '</span>' +

            '<span class="cb-opt-sub">' +
              escapeHtml(
                branches[i].address
              ) +
            '</span>' +

          '</span>' +

        '</button>';
    }

    html +=
      '<button class="cb-back-btn" onclick="cbCancelFlow()">' +
        'Cancelar' +
      '</button>';

    optsEl.innerHTML = html;
  }

  /* =========================================================
     CONTACTO ASIGNADO
  ========================================================= */

  function showWhatsAppPanel(
    assignedContact,
    ticketId,
    directLink
  ) {
    if (
      !assignedContact ||
      !assignedContact.phone
    ) {
      optsEl.innerHTML =
        '<button class="cb-back-btn" onclick="cbGoBack()">' +
          '← Volver al menú principal' +
        '</button>';

      return;
    }

    var whatsappLink =
      directLink ||
      (
        'https://wa.me/' +
        onlyDigits(
          assignedContact.phone
        ) +
        '?text=' +
        encodeURIComponent(
          'Hola, mi folio es ' +
          ticketId +
          '.'
        )
      );

    optsEl.innerHTML =
      '<div class="cb-agent-card">' +

        '<div class="cb-agent-name">' +
          escapeHtml(
            assignedContact.name ||
            'Contacto asignado'
          ) +
        '</div>' +

        '<div class="cb-agent-role">' +
          'Atención KayserBond' +
        '</div>' +

        '<div class="cb-badge">' +
          '📋 Atención por WhatsApp' +
        '</div>' +

      '</div>' +

      '<a ' +
        'class="cb-wa-btn" ' +
        'href="' +
          escapeHtml(
            whatsappLink
          ) +
        '" ' +
        'target="_blank" ' +
        'rel="noopener noreferrer">' +

        'Abrir WhatsApp con ' +
        escapeHtml(
          assignedContact.name ||
          'el contacto asignado'
        ) +

      '</a>' +

      '<button class="cb-back-btn" onclick="cbGoBack()">' +
        '← Volver al menú principal' +
      '</button>';
  }

  function setSubmitting(value) {
    isSubmitting = value;

    var controls =
      optsEl.querySelectorAll(
        'button, input'
      );

    for (
      var i = 0;
      i < controls.length;
      i++
    ) {
      controls[i].disabled =
        value;
    }
  }

  /* =========================================================
     ERRORES
  ========================================================= */

  function friendlyError(error) {
    var code =
      error && error.message
        ? String(error.message)
        : String(error || '');

    if (
      code.indexOf(
        'PRODUCT_NOT_FOUND'
      ) !== -1
    ) {
      return 'Producto no encontrado.';
    }

    if (
      code.indexOf(
        'INVALID_ORDER_DATA'
      ) !== -1
    ) {
      return 'Faltan datos obligatorios del pedido.';
    }

    if (
      code.indexOf(
        'ADDRESS_REQUIRED'
      ) !== -1
    ) {
      return 'Debes escribir la dirección de entrega.';
    }

    if (
      code.indexOf(
        'BRANCH_REQUIRED'
      ) !== -1
    ) {
      return 'Debes seleccionar una sucursal.';
    }

    if (
      code.indexOf(
        'INVALID_TECHNICAL_DATA'
      ) !== -1
    ) {
      return 'Faltan datos obligatorios de la asesoría.';
    }

    if (
      code.indexOf(
        'TOO_MANY_REQUESTS'
      ) !== -1
    ) {
      return 'Se realizaron demasiadas solicitudes. Espera un momento.';
    }

    if (
      code.indexOf(
        'REQUEST_TIMEOUT'
      ) !== -1
    ) {
      return 'El NAS tardó demasiado en responder.';
    }

    if (
      code.indexOf(
        'Failed to fetch'
      ) !== -1
    ) {
      return 'El navegador no pudo conectarse con la API del NAS.';
    }

    return code;
  }

  /* =========================================================
     CREACIÓN DE PEDIDOS
  ========================================================= */

  function createOrderTicket() {
    if (isSubmitting) {
      return;
    }

    setSubmitting(true);
    clearOptions();

    flow.data.pendingTicketType =
      'order';

    var typingId =
      showTyping();

    var payload = {
      sessionId:
        getSessionId(),

      requestId:
        ensureRequestId('ORDER'),

      name:
        flow.data.name,

      phone:
        flow.data.phone,

      city:
        flow.data.city,

      productId:
        flow.data.productQuery ||
        flow.data.productId,

      quantity:
        flow.data.quantity,

      address:
        flow.data.address || '',

      branchId:
        flow.data.branchId || ''
    };

    apiRequest(
      '/api/web/ticket/order',
      {
        method: 'POST',
        body:
          JSON.stringify(payload)
      }
    )
      .then(function (response) {
        removeTyping(typingId);
        setSubmitting(false);

        addMessage(
          '¡Gracias! Ya registré tu pedido.<br><br>' +
          'Tu folio es: <strong>' +
            escapeHtml(
              response.ticketId
            ) +
          '</strong><br><br>' +
          'Un asesor revisará tu solicitud.',
          'in'
        );

        flow.step = 'finished';

        showWhatsAppPanel(
          response.assignedContact,
          response.ticketId,
          response.assignedContactLink
        );
      })
      .catch(function (error) {
        removeTyping(typingId);
        setSubmitting(false);

        addMessage(
          'No pude registrar el pedido en el NAS.<br><br>' +
          'Detalle: ' +
          escapeHtml(
            friendlyError(error)
          ) +
          '<br><br>' +
          'Tus datos siguen guardados.',
          'in'
        );

        optsEl.innerHTML =
          '<button class="cb-opt-btn" onclick="cbRetryTicket()">' +
            '<span class="cb-opt-icon">🔄</span>' +
            '<span class="cb-opt-meta">' +
              '<span class="cb-opt-title">' +
                'Intentar nuevamente' +
              '</span>' +
            '</span>' +
          '</button>' +

          '<button class="cb-back-btn" onclick="cbGoBack()">' +
            '← Volver al menú' +
          '</button>';
      });
  }

  /* =========================================================
     CREACIÓN DE ASESORÍAS
  ========================================================= */

  function createTechnicalTicket() {
    if (isSubmitting) {
      return;
    }

    setSubmitting(true);
    clearOptions();

    flow.data.pendingTicketType =
      'technical';

    var typingId =
      showTyping();

    var payload = {
      sessionId:
        getSessionId(),

      requestId:
        ensureRequestId('TECH'),

      departmentKey:
        flow.data.departmentKey,

      name:
        flow.data.name,

      phone:
        flow.data.phone,

      material:
        flow.data.material,

      conditions:
        flow.data.conditions,

      goal:
        flow.data.goal
    };

    apiRequest(
      '/api/web/ticket/technical',
      {
        method: 'POST',
        body:
          JSON.stringify(payload)
      }
    )
      .then(function (response) {
        removeTyping(typingId);
        setSubmitting(false);

        addMessage(
          'Gracias ✅ Ya registré tu asesoría técnica.<br><br>' +
          'Tu folio es: <strong>' +
            escapeHtml(
              response.ticketId
            ) +
          '</strong><br><br>' +
          'Un asesor revisará tu solicitud.',
          'in'
        );

        flow.step = 'finished';

        showWhatsAppPanel(
          response.assignedContact,
          response.ticketId,
          response.assignedContactLink
        );
      })
      .catch(function (error) {
        removeTyping(typingId);
        setSubmitting(false);

        addMessage(
          'No pude registrar la asesoría técnica en el NAS.<br><br>' +
          'Detalle: ' +
          escapeHtml(
            friendlyError(error)
          ) +
          '<br><br>' +
          'Tus datos siguen guardados.',
          'in'
        );

        optsEl.innerHTML =
          '<button class="cb-opt-btn" onclick="cbRetryTicket()">' +
            '<span class="cb-opt-icon">🔄</span>' +
            '<span class="cb-opt-meta">' +
              '<span class="cb-opt-title">' +
                'Intentar nuevamente' +
              '</span>' +
            '</span>' +
          '</button>' +

          '<button class="cb-back-btn" onclick="cbGoBack()">' +
            '← Volver al menú' +
          '</button>';
      });
  }

  /* =========================================================
     FUNCIONES GLOBALES DE BOTONES
  ========================================================= */

  window.cbPickMenu =
    function (option) {
      var labels = {
        catalogo:
          'Ver catálogo de productos',

        precios:
          'Consultar precio con clave',

        pedido:
          'Hacer pedido',

        asesoria:
          'Asesoría técnica'
      };

      addMessage(
        escapeHtml(
          labels[option] ||
          option
        ),
        'out'
      );

      clearOptions();

      if (!isBusinessHours()) {
        addMessage(
          'Aviso: nuestro horario de atención es de ' +
          businessHoursText() +
          '. Aun así puedes registrar tus datos.',
          'in'
        );
      }

      if (
        option === 'catalogo'
      ) {
        resetFlow();

        botReply(
          'Claro ✅<br><br>' +
          'Puedes abrir el catálogo PDF directamente desde la página.<br><br>' +
          'Después puedes consultar precios, hacer un pedido o solicitar asesoría.',
          showCatalogOptions
        );

        return;
      }

      if (
        option === 'precios'
      ) {
        resetFlow();

        flow.step =
          'price_search_mode';

        botReply(
          '¿Cómo deseas consultar el precio?',
          showPriceSearchMode
        );

        return;
      }

      if (
        option === 'pedido'
      ) {
        resetFlow();

        flow.step =
          'order_name';

        botReply(
          '¡Perfecto! Vamos a registrar tu pedido.',
          function () {
            showTextInput(
              '¿Cuál es tu nombre?',
              'Escribe tu nombre'
            );
          }
        );

        return;
      }

      if (
        option === 'asesoria'
      ) {
        resetFlow();

        flow.step =
          'tech_department';

        botReply(
          'Selecciona el departamento correcto:',
          showDepartmentOptions
        );
      }
    };

  window.cbChoosePriceMode =
    function (mode) {
      if (
        mode === 'search'
      ) {
        addMessage(
          'Buscar por clave o nombre',
          'out'
        );

        flow.step =
          'price_product_query';

        botReply(
          'Escribe la clave o el nombre del producto.<br><br>' +
          'Ejemplos:<br>' +
          '• KPU-101<br>' +
          '• KIM-001<br>' +
          '• ACRILEST MATE<br>' +
          '• CK-314<br><br>' +
          'También puedes escribir pinturas.',
          function () {
            showTextInput(
              'Clave o nombre',
              'Ejemplo: KPU-101'
            );
          }
        );

        return;
      }

      addMessage(
        'Ver todas las pinturas e impermeabilizantes',
        'out'
      );

      loadAndShowPaints(
        'price'
      );
    };

  window.cbPickPaint =
    function (index) {
      var selected =
        paintProducts[index];

      if (!selected) {
        botReply(
          'No encontré esa pintura.',
          function () {
            showPaintOptions(
              paintProducts
            );
          }
        );

        return;
      }

      addMessage(
        escapeHtml(
          selected.product
        ),
        'out'
      );

      clearOptions();

      if (
        flow.step ===
        'order_paint_choice'
      ) {
        selectOrderProduct(
          selected
        );

        return;
      }

      selectPriceProduct(
        selected
      );
    };

  window.cbPickDepartment =
    function (departmentKey) {
      var department =
        DEPARTMENTS[
          departmentKey
        ];

      if (!department) {
        botReply(
          'No reconocí el departamento.',
          showDepartmentOptions
        );

        return;
      }

      addMessage(
        escapeHtml(
          department.label
        ),
        'out'
      );

      clearOptions();

      flow.data.departmentKey =
        department.key;

      flow.step =
        'tech_name';

      botReply(
        '¿Cuál es tu nombre?',
        function () {
          showTextInput(
            '¿Cuál es tu nombre?',
            'Escribe tu nombre'
          );
        }
      );
    };

  window.cbPickBranch =
    function (branchId) {
      var branches =
        getBranches();

      var selected = null;

      for (
        var i = 0;
        i < branches.length;
        i++
      ) {
        if (
          String(
            branches[i].id
          ) ===
          String(branchId)
        ) {
          selected =
            branches[i];

          break;
        }
      }

      if (!selected) {
        botReply(
          'No encontré esa sucursal.',
          function () {
            showBranchOptions(
              'Selecciona una sucursal:'
            );
          }
        );

        return;
      }

      addMessage(
        escapeHtml(
          selected.name
        ),
        'out'
      );

      clearOptions();

      flow.data.branchId =
        selected.id;

      flow.data.branchName =
        selected.name +
        ' - ' +
        selected.address;

      flow.data.deliveryType =
        'Compra o recolección en ' +
        selected.name;

      createOrderTicket();
    };

  window.cbSubmitText =
    function () {
      var input =
        document.getElementById(
          'cb-text-input'
        );

      if (
        !input ||
        isSubmitting
      ) {
        return;
      }

      var value =
        String(
          input.value || ''
        ).trim();

      if (!value) {
        return;
      }

      addMessage(
        escapeHtml(value),
        'out'
      );

      clearOptions();

      handleTextAnswer(value);
    };

  /* =========================================================
     RESPUESTAS ESCRITAS
  ========================================================= */

  function handleTextAnswer(value) {
    var clean =
      normalizeText(value);

    if (
      clean === 'menu' ||
      clean === 'menú' ||
      clean === 'reiniciar' ||
      clean === 'inicio'
    ) {
      resetFlow();

      botReply(
        'Claro, volvemos al menú principal.',
        showMainMenu
      );

      return;
    }

    if (
      clean === 'cancelar'
    ) {
      resetFlow();

      botReply(
        'Proceso cancelado.',
        showMainMenu
      );

      return;
    }

    if (
      clean === 'test'
    ) {
      var testTypingId =
        showTyping();

      apiRequest(
        '/api/web/config',
        {
          method: 'GET'
        }
      )
        .then(function (response) {
          removeTyping(
            testTypingId
          );

          botReply(
            '✅ El chatbot web y el NAS están conectados.<br><br>' +
            'Empresa: ' +
            escapeHtml(
              response.companyName ||
              CONFIG.companyName
            ) +
            '<br>' +
            'Horario: ' +
            escapeHtml(
              response.schedule ||
              businessHoursText()
            ),
            showMainMenu
          );
        })
        .catch(function (error) {
          removeTyping(
            testTypingId
          );

          botReply(
            'El chatbot funciona, pero no pudo comunicarse con el NAS.<br><br>' +
            escapeHtml(
              friendlyError(error)
            ),
            showMainMenu
          );
        });

      return;
    }

    switch (flow.step) {
      case 'price_product_query':
        if (
          clean === 'pinturas' ||
          clean === 'ver pinturas'
        ) {
          loadAndShowPaints(
            'price'
          );

          return;
        }

        searchPriceProduct(value);
        break;

      case 'order_name':
        flow.data.name =
          value;

        flow.step =
          'order_phone';

        botReply(
          'Gracias, ' +
          escapeHtml(value) +
          '.',
          function () {
            showTextInput(
              '¿Cuál es tu número de WhatsApp?',
              'Ejemplo: 4771287534'
            );
          }
        );
        break;

      case 'order_phone':
        var orderPhone =
          normalizeMexicoPhone(value);

        if (!orderPhone) {
          botReply(
            'Escribe un número mexicano válido de 10 dígitos.',
            function () {
              showTextInput(
                'Número de WhatsApp',
                'Ejemplo: 4771287534'
              );
            }
          );

          return;
        }

        flow.data.phone =
          orderPhone;

        flow.step =
          'order_city';

        botReply(
          '¿En qué ciudad te encuentras?',
          function () {
            showTextInput(
              'Ciudad',
              'Ejemplo: León, Guanajuato'
            );
          }
        );
        break;

      case 'order_city':
        flow.data.city =
          value;

        flow.step =
          'order_product_query';

        botReply(
          'Escribe la clave o el nombre del producto.<br><br>' +
          'Ejemplos:<br>' +
          '• KPU-101<br>' +
          '• KIM-001<br>' +
          '• ACRILEST MATE<br>' +
          '• CK-314<br><br>' +
          'También puedes escribir pinturas.',
          function () {
            showTextInput(
              'Clave o nombre',
              'Ejemplo: KPU-101'
            );
          }
        );
        break;

      case 'order_product_query':
        if (
          clean === 'pinturas' ||
          clean === 'ver pinturas'
        ) {
          loadAndShowPaints(
            'order'
          );

          return;
        }

        searchOrderProduct(value);
        break;

      case 'order_quantity':
        var quantity =
          parseQuantity(value);

        if (
          quantity <= 0
        ) {
          botReply(
            'Escribe la cantidad usando un número.',
            function () {
              showTextInput(
                '¿Qué cantidad necesitas?',
                'Ejemplo: 5'
              );
            }
          );

          return;
        }

        flow.data.quantity =
          quantity;

        if (
          quantity >= 5 &&
          isLeonCity(
            flow.data.city
          )
        ) {
          flow.data.deliveryType =
            'Entrega a domicilio en León';

          flow.step =
            'order_address';

          botReply(
            'Escribe la dirección completa de entrega.',
            function () {
              showTextInput(
                'Dirección completa',
                'Calle, número, colonia y referencias'
              );
            }
          );

          return;
        }

        flow.data.deliveryType =
          'Compra o recolección en sucursal';

        flow.step =
          'order_branch';

        botReply(
          quantity >= 5
            ? 'La entrega a domicilio actualmente aplica únicamente en León, Guanajuato.'
            : 'Para pedidos menores a 5 piezas debes seleccionar una sucursal.',
          function () {
            showBranchOptions(
              'Selecciona una sucursal:'
            );
          }
        );
        break;

      case 'order_address':
        flow.data.address =
          value;

        createOrderTicket();
        break;

      case 'tech_name':
        flow.data.name =
          value;

        flow.step =
          'tech_phone';

        botReply(
          'Gracias, ' +
          escapeHtml(value) +
          '.',
          function () {
            showTextInput(
              'Número de WhatsApp',
              'Ejemplo: 4771287534'
            );
          }
        );
        break;

      case 'tech_phone':
        var technicalPhone =
          normalizeMexicoPhone(value);

        if (!technicalPhone) {
          botReply(
            'Escribe un número mexicano válido de 10 dígitos.',
            function () {
              showTextInput(
                'Número de WhatsApp',
                'Ejemplo: 4771287534'
              );
            }
          );

          return;
        }

        flow.data.phone =
          technicalPhone;

        flow.step =
          'tech_material';

        botReply(
          '¿Qué materiales vas a pegar, unir, sellar, pintar o trabajar?',
          function () {
            showTextInput(
              'Materiales',
              'Ejemplo: piel con hule, madera con tela'
            );
          }
        );
        break;

      case 'tech_material':
        flow.data.material =
          value;

        flow.step =
          'tech_conditions';

        botReply(
          '¿En qué condiciones se utilizará?<br><br>' +
          'Ejemplo: calor, humedad, agua, químicos, presión, fricción, movimiento, lavado o sol.',
          function () {
            showTextInput(
              'Condiciones de uso',
              'Ejemplo: humedad, sol y calor'
            );
          }
        );
        break;

      case 'tech_conditions':
        flow.data.conditions =
          value;

        flow.step =
          'tech_goal';

        botReply(
          '¿Qué necesitas que logre el producto?<br><br>' +
          'Ejemplo: pegar fuerte, resistir calor, ser flexible o secar rápido.',
          function () {
            showTextInput(
              'Objetivo',
              'Ejemplo: resistir calor y secar rápido'
            );
          }
        );
        break;

      case 'tech_goal':
        flow.data.goal =
          value;

        createTechnicalTicket();
        break;

      default:
        resetFlow();

        botReply(
          'No entendí tu respuesta. Te muestro el menú principal.',
          showMainMenu
        );
        break;
    }
  }

  window.cbRetryTicket =
    function () {
      if (
        flow.data
          .pendingTicketType ===
        'technical'
      ) {
        createTechnicalTicket();

        return;
      }

      createOrderTicket();
    };

  window.cbCancelFlow =
    function () {
      addMessage(
        'Cancelar',
        'out'
      );

      resetFlow();

      botReply(
        'Proceso cancelado. Volvemos al menú principal.',
        showMainMenu
      );
    };

  window.cbGoBack =
    function () {
      addMessage(
        '↩ Menú principal',
        'out'
      );

      resetFlow();
      clearOptions();

      botReply(
        'Claro, ¿en qué más te puedo ayudar?',
        showMainMenu
      );
    };

  /* =========================================================
     ABRIR Y CERRAR EL CHAT
  ========================================================= */

  function openChat() {
    isOpen = true;

    popup.classList.add(
      'cb-open'
    );

    toggleBtn.classList.add(
      'cb-open'
    );

    toggleBtn.setAttribute(
      'aria-expanded',
      'true'
    );

    msgsEl.scrollTop =
      msgsEl.scrollHeight;
  }

  function closeChat() {
    isOpen = false;

    popup.classList.remove(
      'cb-open'
    );

    toggleBtn.classList.remove(
      'cb-open'
    );

    toggleBtn.setAttribute(
      'aria-expanded',
      'false'
    );
  }

  toggleBtn.addEventListener(
    'click',
    function () {
      if (isOpen) {
        closeChat();
      } else {
        openChat();
      }
    }
  );

  document.addEventListener(
    'keydown',
    function (event) {
      if (
        event.key === 'Escape' &&
        isOpen
      ) {
        closeChat();
      }
    }
  );

  /* =========================================================
     INICIO
  ========================================================= */

  getSessionId();

  initializeServerConnection();

  var initialTypingId =
    showTyping();

  setTimeout(function () {
    removeTyping(
      initialTypingId
    );

    addMessage(
      'Hola, buen día 👋<br>' +
      'Estás hablando con el chatbot de ' +
      escapeHtml(
        CONFIG.companyName
      ) +
      '.',
      'in'
    );

    if (!isBusinessHours()) {
      addMessage(
        'En este momento nuestros asesores no están disponibles.<br>' +
        'Nuestro horario de atención es de ' +
        businessHoursText() +
        '.<br><br>' +
        'Aun así puedes registrar tu información.',
        'in'
      );
    }

    showMainMenu();
    renderAllMessages();
  }, 600);
})();
