const STORAGE = {
  cart: "forma.cart.v1",
};

const state = {
  products: [],
  currentUser: null,
  cart: load(STORAGE.cart, []),
  settings: { currency: "NGN", shippingFee: 3500, freeShippingThreshold: 100000, storeName: "BeadsbyBambie" },
  csrfToken: "",
  category: "All",
  search: "",
  sort: "featured",
  adminTab: "products",
  adminCustomers: [],
  editingProduct: null,
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const overlay = $("#overlay");
const drawer = $("#drawer");
const drawerTitle = $("#drawer-title");
const drawerKicker = $("#drawer-kicker");
const drawerContent = $("#drawer-content");
let toastTimer;
let cartSync = Promise.resolve();

function load(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : structuredClone(fallback);
  } catch (error) {
    console.error(`Unable to load ${key} from browser storage.`, error);
    return structuredClone(fallback);
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key} to browser storage.`, error);
    showToast("Could not save changes in this browser.");
  }
}
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers.set("X-CSRF-Token", state.csrfToken);
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers,
    body: options.body instanceof FormData ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}
function money(amount) {
  return formatCurrency(amount, state.settings.currency || "NGN");
}
function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "NGN" ? 0 : 2,
    }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
  }
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function whatsappContactLink(className = "") {
  const message = encodeURIComponent("Hello, BeadsbyBambie, there is something I need");
  return `<a class="whatsapp-link ${className}" href="https://wa.me/2347034449648?text=${message}" target="_blank" rel="noopener noreferrer" aria-label="Reach us on WhatsApp at +234 703 444 9648"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.82 11.82 0 0 0 12.08 0C5.52 0 .18 5.34.18 11.9c0 2.1.55 4.15 1.59 5.96L.08 24l6.3-1.65a11.9 11.9 0 0 0 5.7 1.45h.01c6.56 0 11.9-5.34 11.91-11.9a11.82 11.82 0 0 0-3.48-8.42ZM12.09 21.8h-.01a9.88 9.88 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.38a9.88 9.88 0 0 1-1.52-5.26c0-5.46 4.45-9.9 9.92-9.9a9.83 9.83 0 0 1 7.01 2.91 9.83 9.83 0 0 1 2.9 7.02c0 5.47-4.45 9.91-9.93 9.91Zm5.44-7.42c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.06 2.89 1.21 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.27.5 1.7.64.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"/></svg>Reach us on WhatsApp</a>`;
}
function confirmationActions() {
  return `<div class="confirmation-actions"><a class="button button-dark confirmation-home" href="/">Back to homepage <span>↗</span></a>${whatsappContactLink("confirmation-whatsapp")}</div>`;
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}
function persistCart() {
  save(STORAGE.cart, state.cart);
  updateCartCount();
  if (state.currentUser) {
    cartSync = cartSync.catch(() => {}).then(() => api("/api/cart", { method: "PUT", body: { items: state.cart } }))
      .catch(error => showToast(error.message));
  }
}
async function restoreAccountCart(mergeLocal = false) {
  const localCart = mergeLocal ? state.cart : [];
  const { items } = await api("/api/cart");
  const quantities = new Map(items.map(item => [item.productId, item.quantity]));
  for (const item of localCart) {
    quantities.set(item.productId, Math.min(20, (quantities.get(item.productId) || 0) + item.quantity));
  }
  state.cart = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
  if (mergeLocal) persistCart();
  else {
    save(STORAGE.cart, state.cart);
    updateCartCount();
  }
}
function updateCartCount() {
  $(".cart-count").textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
}
function displayPrice(product) {
  const regular = Number(product.price);
  const promo = Number(product.promoPrice);
  if (Number.isFinite(promo) && promo > 0 && promo < regular) {
    return `<span class="old-price">${money(regular)}</span><span class="sale-price">${money(promo)}</span>`;
  }
  return money(regular);
}
function renderCategories() {
  const categories = ["All", ...new Set(state.products.map(product => product.category).filter(Boolean))];
  $("#category-pills").innerHTML = categories.map(category =>
    `<button class="category-pill${category === state.category ? " active" : ""}" data-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`
  ).join("");
}
function visibleProducts() {
  let products = state.products.filter(product => {
    const matchesCategory = state.category === "All" || product.category === state.category;
    const matchesSearch = !state.search || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(state.search.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  if (state.sort === "price-asc") products.sort((a, b) => effectivePrice(a) - effectivePrice(b));
  if (state.sort === "price-desc") products.sort((a, b) => effectivePrice(b) - effectivePrice(a));
  return products;
}
function effectivePrice(product) {
  const promo = Number(product.promoPrice);
  return promo > 0 && promo < Number(product.price) ? promo : Number(product.price);
}
function renderProducts() {
  renderCategories();
  $("#product-grid").setAttribute("aria-busy", "false");
  $("#product-grid").removeAttribute("aria-label");
  const threshold = money(state.settings.freeShippingThreshold);
  $("#announcement-threshold").textContent = threshold;
  $("#shipping-threshold").textContent = threshold;
  const products = visibleProducts();
  $("#product-grid").innerHTML = products.length ? products.map(product => `
    <article class="product-card">
      <div class="product-image-wrap">
          <img class="product-image" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
        ${product.badge ? `<span class="product-badge">${escapeHTML(product.badge)}</span>` : ""}
        <button class="quick-add" data-add="${escapeHTML(product.id)}" aria-label="Add ${escapeHTML(product.name)} to bag">+</button>
      </div>
      <div class="product-info"><div class="product-meta"><h3 class="product-name">${escapeHTML(product.name)}</h3><span class="product-price">${displayPrice(product)}</span></div><p class="product-category">${escapeHTML(product.category)}</p></div>
    </article>`).join("") : `<div class="empty-state"><h3>No pieces found</h3><p>Try another category or search for something else.</p></div>`;
}
function openDrawer(title, kicker = `YOUR ${state.settings.storeName.toUpperCase()}`) {
  drawerTitle.textContent = title;
  drawerKicker.textContent = kicker;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  $(".close-button").focus();
}
function closeDrawer() {
  overlay.hidden = true;
  document.body.style.overflow = "";
}
function addToCart(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return showToast("That product is no longer available.");
  const existing = state.cart.find(item => item.productId === id);
  if (existing && existing.quantity >= 20) return showToast("You can add up to 20 of one item.");
  if (existing) existing.quantity += 1;
  else if (state.cart.length >= 50) return showToast("Your bag can contain up to 50 products.");
  else state.cart.push({ productId: id, quantity: 1 });
  persistCart();
  showToast(`${product.name} added to your bag`);
}
function cartProducts() {
  state.cart = state.cart.filter(item => state.products.some(product => product.id === item.productId) && item.quantity > 0);
  return state.cart.map(item => ({ ...item, product: state.products.find(product => product.id === item.productId) }));
}
function renderCart() {
  const items = cartProducts();
  if (!items.length) {
    drawerContent.innerHTML = `<div class="empty-state"><div class="empty-mark">＋</div><h3>Your bag is waiting to sparkle.</h3><p>Find a beaded piece that feels like you.</p><button class="button button-dark" data-action="continue-shopping">Explore the collection <span>↗</span></button></div>`;
    return;
  }
  const subtotal = items.reduce((sum, item) => sum + effectivePrice(item.product) * item.quantity, 0);
  drawerContent.innerHTML = `${items.map(({ product, quantity }) => `
    <div class="cart-row"><img src="${escapeHTML(product.image)}" alt=""><div><h3>${escapeHTML(product.name)}</h3><div class="price-line">${displayPrice(product)}</div><div class="quantity"><button data-quantity="-1" data-id="${escapeHTML(product.id)}" aria-label="Decrease quantity">−</button><span>${quantity}</span><button data-quantity="1" data-id="${escapeHTML(product.id)}" aria-label="Increase quantity">+</button></div></div><button class="remove-item" data-remove="${escapeHTML(product.id)}">Remove</button></div>`).join("")}
    <div class="cart-summary"><div class="summary-line"><span>Subtotal</span><span>${money(subtotal)}</span></div><div class="summary-line"><span>Delivery</span><span>Calculated at checkout</span></div><p class="muted">Choose a delivery destination at checkout for an estimated fee. Nigerian delivery is free from ${money(state.settings.freeShippingThreshold)}.</p><button class="full-button" data-action="checkout">Continue to checkout</button></div>`;
}
function openCart() {
  openDrawer("Your bag");
  renderCart();
}
async function openAccount() {
  if (!state.currentUser) return renderSignIn();
  openDrawer("Your account");
  let orders;
  try {
    ({ orders } = await api("/api/account/orders"));
  } catch (error) {
    showToast(error.message);
    return;
  }
  drawerContent.innerHTML = `<div class="account-card"><strong>${escapeHTML(state.currentUser.name)}</strong><span>${escapeHTML(state.currentUser.email)}</span></div>${state.currentUser.isAdmin ? `<button class="full-button" data-action="owner-settings">Store settings</button>` : ""}<h3 class="admin-section-title">Your orders</h3>${orders.length ? orders.map(orderCard).join("") : `<p class="muted">Your orders will appear here once you place one.</p>`}<button class="full-button" data-action="signout">Sign out</button>`;
}
function renderSignIn() {
  openDrawer("Welcome back");
  drawerContent.innerHTML = `<div class="admin-tabs"><button class="admin-tab active" data-account-mode="signin">Sign in</button><button class="admin-tab" data-account-mode="signup">Create account</button></div><form class="form-stack" id="account-form" data-mode="signin"><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Your name<input name="name" autocomplete="name" placeholder="Your name" hidden></label><label>Password<input name="password" type="password" minlength="12" required autocomplete="current-password" placeholder="At least 12 characters"></label><button class="full-button">Sign in</button></form><p class="form-switch">Use at least 12 characters for a secure password.</p>`;
}
function orderCard(order) {
  return `<div class="order-card"><h3>Order ${escapeHTML(order.reference)}</h3><p>${new Date(order.createdAt).toLocaleDateString()} · ${formatCurrency(order.total, order.currency)}</p><p>Status: ${escapeHTML(order.status)}</p></div>`;
}
async function renderOrderConfirmationPage(reference) {
  document.body.classList.add("order-confirmation-page");
  const page = $("#order-confirmation");
  page.hidden = false;
  document.title = "Order confirmation — BeadsbyBambie";
  try {
    if (!reference) throw new Error("No order reference was provided.");
    const { order, bankDetails } = await api(`/api/account/orders/${encodeURIComponent(reference)}`);
    presentOrderConfirmation(order, bankDetails);
  } catch (error) {
    page.innerHTML = `<div class="order-confirmation-card"><p class="eyebrow">ORDER DETAILS</p><h1>We couldn’t load this order.</h1><p class="muted">${escapeHTML(error.message)} Sign in with the account used to place the order, then reopen its confirmation link.</p>${confirmationActions()}</div>`;
  }
}
function presentOrderConfirmation(order, bankDetails) {
  document.body.classList.add("order-confirmation-page");
  const page = $("#order-confirmation");
  page.hidden = false;
  document.title = "Order confirmation — BeadsbyBambie";
  page.innerHTML = `<div class="order-confirmation-card"><div class="confirmation-mark" aria-hidden="true">✓</div><p class="eyebrow">THANK YOU FOR YOUR ORDER</p><h1>Your order is confirmed.</h1><p class="confirmation-intro">Thank you, ${escapeHTML(order.customerName)}. We’ve received your order and saved the details below.</p><div class="confirmation-reference"><span>Order reference</span><strong>${escapeHTML(order.reference)}</strong></div><div class="confirmation-status"><span>Current status</span><strong>${escapeHTML(order.status)}</strong></div><section class="confirmation-section"><h2>Order details</h2>${order.items.map(item => `<div class="confirmation-item"><div><strong>${escapeHTML(item.name)}</strong><span>Quantity: ${item.quantity}</span>${item.customDescription ? `<small>Your request: ${escapeHTML(item.customDescription)}</small>` : ""}</div><strong>${formatCurrency(item.unitPrice * item.quantity, order.currency)}</strong></div>`).join("")}<div class="confirmation-total"><div><span>Items</span><span>${formatCurrency(order.subtotal, order.currency)}</span></div><div><span>Delivery</span><span>${formatCurrency(order.shipping, order.currency)}</span></div><div class="confirmation-grand-total"><strong>Total</strong><strong>${formatCurrency(order.total, order.currency)}</strong></div></div></section><section class="confirmation-section"><h2>Delivery</h2><p>${escapeHTML(order.customerName)} · ${escapeHTML(order.phone)}</p><p>${escapeHTML(order.address)}</p></section><section class="confirmation-section"><h2>Payment</h2>${bankDetails ? `<p>Complete your bank transfer using your order reference as the payment description.</p><div class="confirmation-bank"><span>Bank</span><strong>${escapeHTML(bankDetails.bankName)}</strong><span>Account name</span><strong>${escapeHTML(bankDetails.accountName)}</strong><span>Account number</span><strong>${escapeHTML(bankDetails.accountNumber)}</strong>${bankDetails.instructions ? `<span>Payment instructions</span><strong>${escapeHTML(bankDetails.instructions)}</strong>` : ""}</div>` : `<p class="muted">The store owner has not added bank details yet. Please contact the store owner to arrange payment.</p>`}</section>${confirmationActions()}</div>`;
}
function beginCheckout() {
  if (!state.cart.length) return renderCart();
  if (!state.currentUser) {
    renderSignIn();
    showToast("Create an account or sign in before checkout.");
    return;
  }
  renderCheckout();
}
function renderCheckout() {
  const items = cartProducts();
  const subtotal = items.reduce((sum, item) => sum + effectivePrice(item.product) * item.quantity, 0);
  openDrawer("Delivery & payment");
  drawerContent.innerHTML = `<div class="notice">Payment is by manual bank transfer. Your order will be marked <strong>awaiting payment</strong> until you confirm the transfer.</div><form class="form-stack" id="checkout-form"><label>Full name<input name="name" required value="${escapeHTML(state.currentUser.name)}" autocomplete="name"></label><label>Delivery destination<select name="countryCode" id="delivery-country" required><option value="">Choose a destination</option><option value="NG">Nigeria</option><option value="INTL">Outside Nigeria</option></select></label><div id="nigeria-location" hidden><label>State or territory<select name="state" id="delivery-state" required><option value="">Choose your state</option>${(state.settings.deliveryLocations || []).map(location => `<option value="${escapeHTML(location)}">${escapeHTML(location)}</option>`).join("")}</select></label></div><div id="international-location" hidden><label>Country<input name="country" id="delivery-country-name" maxlength="100" autocomplete="country-name" placeholder="Enter destination country" disabled></label><p class="form-hint">International delivery uses a flat estimate. Customs charges, if any, are not included.</p></div><label>Street address and city<textarea name="address" required autocomplete="street-address" placeholder="Street, area, city or town"></textarea></label><label>Phone number<input name="phone" required autocomplete="tel" placeholder="+234 800 000 0000"></label><h3 class="admin-section-title">Product requests</h3><p class="muted">Tell us any colours, design details, or other customizations you want for each item. This is optional.</p>${items.map(({ product, quantity }) => `<label>${escapeHTML(product.name)} × ${quantity}<textarea name="customDescription_${escapeHTML(product.id)}" maxlength="500" placeholder="Describe the colours, design, or details you would like"></textarea></label>`).join("")}<div class="cart-summary"><div class="summary-line"><span>${items.reduce((sum, item) => sum + item.quantity, 0)} items · Subtotal</span><span>${money(subtotal)}</span></div><div class="summary-line"><span>Delivery</span><span id="delivery-fee">Choose a destination</span></div><p class="form-hint" id="delivery-estimate"></p><div class="summary-line total"><span>Order total</span><span id="order-total">${money(subtotal)}</span></div></div><button class="full-button" disabled>Place order</button></form><p class="form-switch"><button class="link-button" data-action="back-to-cart">Return to bag</button></p>`;
}
let quoteRequestId = 0;
async function refreshDeliveryQuote(form) {
  const requestId = ++quoteRequestId;
  const destination = $('select[name="countryCode"]', form).value;
  const stateName = $('select[name="state"]', form).value;
  const country = $('input[name="country"]', form).value.trim();
  const feeDisplay = $("#delivery-fee", form);
  const estimateDisplay = $("#delivery-estimate", form);
  const totalDisplay = $("#order-total", form);
  const submitButton = $(".full-button", form);
  const subtotal = cartProducts().reduce((sum, item) => sum + effectivePrice(item.product) * item.quantity, 0);
  const thresholdFree = destination === "NG" && subtotal >= state.settings.freeShippingThreshold;
  if (!destination || (destination === "NG" && !stateName) || (destination === "INTL" && !country)) {
    feeDisplay.textContent = "Choose a destination";
    estimateDisplay.textContent = "";
    totalDisplay.textContent = money(subtotal);
    submitButton.disabled = true;
    return;
  }
  feeDisplay.textContent = "Calculating…";
  estimateDisplay.textContent = "";
  submitButton.disabled = true;
  try {
    const params = new URLSearchParams({
      countryCode: destination,
      state: stateName,
      subtotal: String(subtotal),
    });
    const quote = await api(`/api/delivery/quote?${params}`);
    if (requestId !== quoteRequestId) return;
    feeDisplay.textContent = quote.fee ? money(quote.fee) : "Complimentary";
    totalDisplay.textContent = money(subtotal + quote.fee);
    estimateDisplay.textContent = destination === "NG"
      ? `${thresholdFree ? "Free Nigerian delivery applies. " : ""}Reference distance from Abeokuta to the state capital: about ${quote.estimatedRoadKm} km. Final courier route may vary.`
      : "Flat international delivery estimate; customs charges, if any, are not included.";
    submitButton.disabled = false;
  } catch (error) {
    if (requestId !== quoteRequestId) return;
    feeDisplay.textContent = "Unavailable";
    estimateDisplay.textContent = error.message;
    totalDisplay.textContent = money(subtotal);
  }
}
async function completeOrder(values) {
  const { order, bankDetails } = await api("/api/orders", {
    method: "POST",
    body: {
      name: values.name.trim(),
      address: values.address.trim(),
      phone: values.phone.trim(),
      countryCode: values.countryCode,
      state: values.state,
      country: values.country,
      items: state.cart.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        customDescription: values[`customDescription_${item.productId}`]?.trim() || "",
      })),
    },
  });
  state.cart = [];
  save(STORAGE.cart, state.cart);
  updateCartCount();
  closeDrawer();
  const confirmationUrl = `/order-confirmation.html?reference=${encodeURIComponent(order.reference)}`;
  history.replaceState(null, "", confirmationUrl);
  presentOrderConfirmation(order, bankDetails);
}
function openAdmin(tab = "products") {
  if (!state.currentUser?.isAdmin) {
    renderSignIn();
    showToast("Sign in with the store-owner account to open the dashboard.");
    return;
  }
  state.adminTab = tab;
  state.editingProduct = null;
  openDrawer("Owner dashboard", "STORE MANAGEMENT");
  renderAdmin();
}
async function renderAdmin() {
  const tabs = ["products", "orders", "customers", "settings"];
  drawerContent.innerHTML = `<div class="admin-tabs">${tabs.map(tab => `<button class="admin-tab${state.adminTab === tab ? " active" : ""}" data-admin-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</div><div class="admin-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Loading ${escapeHTML(state.adminTab)}…</span></div>`;
  try {
    if (state.adminTab === "orders") ({ orders: state.adminOrders } = await api("/api/admin/orders"));
    if (state.adminTab === "customers") ({ customers: state.adminCustomers } = await api("/api/admin/customers"));
    if (state.adminTab === "settings") ({ settings: state.settings } = await api("/api/admin/settings"));
    drawerContent.innerHTML = `<div class="admin-tabs">${tabs.map(tab => `<button class="admin-tab${state.adminTab === tab ? " active" : ""}" data-admin-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</div>${state.adminTab === "products" ? renderAdminProducts() : state.adminTab === "orders" ? renderAdminOrders() : state.adminTab === "customers" ? renderAdminCustomers() : renderAdminSettings()}`;
  } catch (error) {
    drawerContent.innerHTML = `<p class="muted">${escapeHTML(error.message)}</p>`;
  }
}
function renderAdminProducts() {
  if (state.editingProduct !== null) return renderProductForm(state.editingProduct);
  return `<button class="full-button" data-action="add-product">＋ Add a product</button><h3 class="admin-section-title admin-products-title">Your products (${state.products.length})</h3>${state.products.map(product => `<div class="admin-product"><img src="${escapeHTML(product.image)}" alt=""><div><strong>${escapeHTML(product.name)}</strong><span>${escapeHTML(product.category)} · ${displayPrice(product)}</span></div><div class="admin-actions"><button data-edit="${escapeHTML(product.id)}">Edit</button><button data-delete="${escapeHTML(product.id)}">Delete</button></div></div>`).join("") || `<p class="muted">No products yet. Add your first product to get started.</p>`}`;
}
function renderProductForm(id) {
  const product = id ? state.products.find(item => item.id === id) : null;
  return `<h3 class="admin-section-title">${product ? "Edit product" : "Add a product"}</h3><form class="form-stack" id="product-form"><label>Product name<input name="name" required value="${escapeHTML(product?.name || "")}"></label><label>Category<input name="category" required value="${escapeHTML(product?.category || "")}" placeholder="Beaded Bags, Accessories, Jewellery"></label><label>Product photo<input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"></label><label>Or use an HTTPS image URL<input name="image" type="url" value="${escapeHTML(product?.image?.startsWith("/uploads/") ? "" : product?.image || "")}" placeholder="https://..."></label><p class="form-hint">JPG, PNG, or WebP files up to 8 MB are stored in your product-image library.</p><label>Regular price (${escapeHTML(state.settings.currency)})<input name="price" type="text" inputmode="decimal" required value="${escapeHTML(product?.price ?? "")}" placeholder="e.g. 25,000"></label><label>Promo price — optional<input name="promoPrice" type="text" inputmode="decimal" value="${escapeHTML(product?.promoPrice ?? "")}" placeholder="Leave blank for no promotion"></label><label>Badge — optional<input name="badge" value="${escapeHTML(product?.badge || "")}" placeholder="Bestseller, Just in..."></label><label>Description<textarea name="description">${escapeHTML(product?.description || "")}</textarea></label><button class="full-button">${product ? "Save product" : "Add product"}</button><button type="button" class="link-button" data-action="cancel-product">Cancel</button></form>`;
}
function parsePrice(value) {
  const text = String(value).trim();
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(text)) return NaN;
  return Number(text.replaceAll(",", ""));
}
function renderAdminOrders() {
  const orders = state.adminOrders || [];
  return `<h3 class="admin-section-title">Customer orders (${orders.length})</h3>${orders.length ? orders.map(order => `<div class="admin-order"><div class="admin-order-top"><span>${escapeHTML(order.reference)}</span><span>${formatCurrency(order.total, order.currency)}</span></div><p>${escapeHTML(order.customerName)} · ${escapeHTML(order.customerEmail)}</p><p>Subtotal ${formatCurrency(order.subtotal, order.currency)} · Delivery ${formatCurrency(order.shipping, order.currency)}</p>${order.items.map(item => `<p>${escapeHTML(item.name)} × ${item.quantity}${item.customDescription ? `<br><strong>Customer request:</strong> ${escapeHTML(item.customDescription)}` : ""}</p>`).join("")}<p>${escapeHTML(order.address)}</p><span class="status-tag">${escapeHTML(order.status)}</span><label class="form-label">Update status<select class="status-select" data-order-status="${escapeHTML(order.reference)}"><option${order.status === "Awaiting payment" ? " selected" : ""}>Awaiting payment</option><option${order.status === "Payment received" ? " selected" : ""}>Payment received</option><option${order.status === "Processing" ? " selected" : ""}>Processing</option><option${order.status === "Shipped" ? " selected" : ""}>Shipped</option><option${order.status === "Completed" ? " selected" : ""}>Completed</option><option${order.status === "Cancelled" ? " selected" : ""}>Cancelled</option></select></label></div>`).join("") : `<p class="muted">Orders placed by customers will appear here.</p>`}`;
}
function renderAdminCustomers() {
  const customers = state.adminCustomers || [];
  return `<h3 class="admin-section-title">Customer accounts (${customers.length})</h3><p class="form-hint">Deleting an account removes its login, saved cart, newsletter subscription, and personal details from past orders. Order items, totals, and status remain in your records.</p>${customers.length ? customers.map(customer => `<div class="admin-customer"><div class="admin-customer-details"><strong>${escapeHTML(customer.name)}</strong><span>${escapeHTML(customer.email)}</span><small>${customer.orderCount} ${customer.orderCount === 1 ? "order" : "orders"} · Joined ${escapeHTML(new Date(customer.createdAt).toLocaleDateString())}</small></div><button class="admin-customer-delete" type="button" data-customer-delete="${escapeHTML(customer.id)}">Delete account</button></div>`).join("") : `<p class="muted">No customer accounts yet.</p>`}`;
}
function renderAdminSettings() {
  return `<h3 class="admin-section-title">Store & payment details</h3><form class="form-stack" id="settings-form"><label>Store name<input name="storeName" required value="${escapeHTML(state.settings.storeName)}"></label><label>Store currency<select name="currency">${["NGN", "USD", "GBP", "EUR", "CAD", "AUD", "KES", "GHS", "INR"].map(currency => `<option${state.settings.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}</select></label><h3 class="admin-section-title">Delivery pricing (NGN)</h3><p class="form-hint">Nigeria quotes use estimated road distance from Abeokuta: base fee plus rate per estimated kilometre, rounded up to the nearest ₦500. International delivery is a flat estimate.</p><label>Nigeria base delivery fee<input name="domesticDeliveryBaseFee" type="number" min="0" max="10000000" step="500" required value="${escapeHTML(state.settings.domesticDeliveryBaseFee)}"></label><label>Nigeria fee per estimated km<input name="domesticDeliveryPerKmFee" type="number" min="0" max="10000000" step="1" required value="${escapeHTML(state.settings.domesticDeliveryPerKmFee)}"></label><label>International flat fee<input name="internationalDeliveryFee" type="number" min="0" max="10000000" step="500" required value="${escapeHTML(state.settings.internationalDeliveryFee)}"></label><label>Free Nigerian delivery from<input name="freeShippingThreshold" type="number" min="0" max="10000000" step="1" required value="${escapeHTML(state.settings.freeShippingThreshold)}"></label><label>Bank name<input name="bankName" value="${escapeHTML(state.settings.bankName)}" placeholder="Your bank"></label><label>Account name<input name="accountName" value="${escapeHTML(state.settings.accountName)}" placeholder="Name on the account"></label><label>Account number<input name="accountNumber" value="${escapeHTML(state.settings.accountNumber)}" placeholder="Account number"></label><label>Additional payment instructions<textarea name="instructions" placeholder="Include a payment reference, transfer deadline, etc.">${escapeHTML(state.settings.instructions)}</textarea></label><button class="full-button">Save store details</button></form><p class="form-switch">Bank details are shown only to the customer after an order is placed.</p>`;
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
$("#year").textContent = new Date().getFullYear();
updateCartCount();
const heroSlides = $$(".hero-slide");
const heroSlideDots = $$(".hero-slide-dot");
if (heroSlides.length > 1 && heroSlides.length === heroSlideDots.length) {
  const hero = $(".hero-image");
  const slideNumber = $(".hero-image-number");
  let currentSlide = 0;
  let slideTimer;
  function showHeroSlide(index) {
    currentSlide = (index + heroSlides.length) % heroSlides.length;
    heroSlides.forEach((slide, slideIndex) => {
      const active = slideIndex === currentSlide;
      slide.classList.toggle("is-active", active);
      if (active) hero.style.setProperty("--slide-image", `url("${slide.src}")`);
    });
    heroSlideDots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentSlide;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-pressed", String(active));
    });
    slideNumber.textContent = `${String(currentSlide + 1).padStart(2, "0")} / ${String(heroSlides.length).padStart(2, "0")}`;
  }
  function startHeroTimer() {
    clearInterval(slideTimer);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !document.hidden) {
      slideTimer = setInterval(() => showHeroSlide(currentSlide + 1), 6000);
    }
  }
  heroSlideDots.forEach((dot, index) => dot.addEventListener("click", () => {
    showHeroSlide(index);
    startHeroTimer();
  }));
  document.addEventListener("visibilitychange", startHeroTimer);
  hero.addEventListener("pointerenter", () => clearInterval(slideTimer));
  hero.addEventListener("pointerleave", startHeroTimer);
  hero.addEventListener("focusin", () => clearInterval(slideTimer));
  hero.addEventListener("focusout", startHeroTimer);
  showHeroSlide(0);
  startHeroTimer();
}
async function initializeStorefront() {
  if (window.location.pathname === "/order-confirmation.html") {
    await renderOrderConfirmationPage(new URLSearchParams(window.location.search).get("reference"));
    return;
  }
  const data = await api("/api/bootstrap");
  state.products = data.products;
  state.settings = { ...state.settings, ...data.settings };
  state.currentUser = data.user;
  state.csrfToken = data.csrfToken;
  renderProducts();
  if (window.location.pathname === "/owner.html") openAdmin();
  if (state.currentUser) {
    try { await restoreAccountCart(); }
    catch (error) { showToast(error.message); }
  }
}
initializeStorefront().catch(error => {
  console.error("Unable to load the storefront.", error);
  if (window.location.pathname === "/order-confirmation.html") {
    $("#order-confirmation").innerHTML = `<div class="order-confirmation-card"><p class="eyebrow">ORDER DETAILS</p><h1>We couldn’t load this order.</h1><p class="muted">${escapeHTML(error.message)} Please refresh the page to try again.</p>${confirmationActions()}</div>`;
  } else {
    $("#product-grid").innerHTML = `<div class="empty-state"><h3>Store temporarily unavailable</h3><p>${escapeHTML(error.message)} Please refresh the page.</p></div>`;
    $("#product-grid").setAttribute("aria-busy", "false");
    $("#product-grid").removeAttribute("aria-label");
  }
});

document.addEventListener("click", async event => {
  if (event.target === overlay) return closeDrawer();
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches(".quick-add")) addToCart(target.dataset.add);
  else if (target.matches(".cart-trigger")) openCart();
  else if (target.matches(".account-toggle")) openAccount();
  else if (target.matches(".search-toggle")) {
    const query = prompt("Search the collection");
    if (query !== null) {
      state.search = query.trim();
      state.category = "All";
      renderProducts();
      $("#shop").scrollIntoView({ behavior: "smooth" });
    }
  } else if (target.matches(".close-button") || target === overlay) closeDrawer();
  else if (target.matches("[data-category]")) {
    state.category = target.dataset.category;
    renderProducts();
  } else if (target.matches("[data-category-link]")) {
    state.category = target.dataset.categoryLink;
    renderProducts();
  } else if (target.matches("[data-add]")) addToCart(target.dataset.add);
  else if (target.matches("[data-quantity]")) {
    const item = state.cart.find(entry => entry.productId === target.dataset.id);
    if (item && item.quantity >= 20 && Number(target.dataset.quantity) > 0) return showToast("You can add up to 20 of one item.");
    if (item) item.quantity += Number(target.dataset.quantity);
    state.cart = state.cart.filter(entry => entry.quantity > 0);
    persistCart();
    renderCart();
  } else if (target.matches("[data-remove]")) {
    state.cart = state.cart.filter(entry => entry.productId !== target.dataset.remove);
    persistCart();
    renderCart();
  } else if (target.dataset.action === "continue-shopping" || target.dataset.action === "done") closeDrawer();
  else if (target.dataset.action === "checkout") beginCheckout();
  else if (target.dataset.action === "back-to-cart") renderCart();
  else if (target.dataset.action === "owner-settings") openAdmin("settings");
  else if (target.dataset.action === "signout") {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
      state.currentUser = null;
      state.csrfToken = "";
      state.cart = [];
      persistCart();
      const data = await api("/api/bootstrap");
      state.csrfToken = data.csrfToken;
    } catch (error) {
      return showToast(error.message);
    }
    closeDrawer();
    showToast("You have signed out.");
  } else if (target.dataset.accountMode) {
    const mode = target.dataset.accountMode;
    $$(".admin-tab", drawerContent).forEach(tab => tab.classList.toggle("active", tab.dataset.accountMode === mode));
    const form = $("#account-form");
    const nameInput = $('input[name="name"]', form);
    nameInput.hidden = mode !== "signup";
    nameInput.required = mode === "signup";
    $('input[name="password"]', form).autocomplete = mode === "signup" ? "new-password" : "current-password";
    $(".full-button", form).textContent = mode === "signup" ? "Create account" : "Sign in";
    form.dataset.mode = mode;
  } else if (target.matches("[data-admin-tab]")) {
    state.adminTab = target.dataset.adminTab;
    state.editingProduct = null;
    renderAdmin();
  } else if (target.dataset.action === "add-product") {
    state.editingProduct = "";
    renderAdmin();
  } else if (target.matches("[data-edit]")) {
    state.editingProduct = target.dataset.edit;
    renderAdmin();
  } else if (target.dataset.action === "cancel-product") {
    state.editingProduct = null;
    renderAdmin();
  } else if (target.matches("[data-delete]")) {
    const product = state.products.find(item => item.id === target.dataset.delete);
    if (product && confirm(`Delete "${product.name}" from the store?`)) {
    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      state.products = state.products.filter(item => item.id !== product.id);
      renderProducts();
      renderAdmin();
    } catch (error) { showToast(error.message); }
    }
  } else if (target.matches("[data-customer-delete]")) {
    const customer = state.adminCustomers.find(item => item.id === target.dataset.customerDelete);
    if (customer && confirm(`Delete the account for ${customer.name} (${customer.email})?\n\nTheir saved cart, newsletter subscription, and personal details on past orders will be removed. Order items, totals, and statuses will be kept. This cannot be undone.`)) {
      try {
        await api(`/api/admin/customers/${encodeURIComponent(customer.id)}`, { method: "DELETE" });
        await renderAdmin();
        showToast("Customer account deleted. Order records were retained.");
      } catch (error) { showToast(error.message); }
    }
  } else if (target.matches("#view-all")) {
    state.category = "All";
    state.search = "";
    renderProducts();
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  if (form.id === "account-form") {
    event.preventDefault();
    const values = formObject(form);
    const mode = form.dataset.mode || "signin";
    try {
      const result = await api(mode === "signup" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: { name: values.name, email: values.email, password: values.password },
      });
      state.currentUser = result.user;
      state.csrfToken = result.csrfToken;
      await restoreAccountCart(true);
    } catch (error) {
      return showToast(error.message);
    }
    if (state.currentUser.isAdmin) openAdmin();
    else if (state.cart.length) renderCheckout();
    else openAccount();
    showToast(mode === "signup" ? "Your account is ready." : "Welcome back.");
  } else if (form.id === "checkout-form") {
    event.preventDefault();
    const submitButton = $(".full-button", form);
    submitButton.disabled = true;
    submitButton.dataset.originalText = submitButton.textContent;
    submitButton.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span> Placing your order…`;
    try {
      await completeOrder(formObject(form));
    } catch (error) {
      showToast(error.message);
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || "Place order";
      delete submitButton.dataset.originalText;
    }
  } else if (form.id === "product-form") {
    event.preventDefault();
    const values = formObject(form);
    const price = parsePrice(values.price);
    const promoPrice = values.promoPrice.trim() ? parsePrice(values.promoPrice) : null;
    if (!Number.isFinite(price) || price <= 0 || price > 10000000 || (promoPrice !== null && (!Number.isFinite(promoPrice) || promoPrice <= 0 || promoPrice >= price))) {
      return showToast("Enter a valid price (commas are okay); any promo price must be lower than the regular price.");
    }
    const existing = state.products.find(item => item.id === state.editingProduct);
    const imageFile = $('input[name="imageFile"]', form).files[0];
    let image;
    try {
      if (imageFile) {
        const upload = new FormData();
        upload.append("image", imageFile);
        ({ image } = await api("/api/admin/uploads", { method: "POST", body: upload }));
      } else image = values.image.trim() || existing?.image;
    } catch (error) {
      showToast(error.message);
      return;
    }
    if (!image) return showToast("Choose a product photo or enter an image URL.");
    const productValues = { name: values.name.trim(), category: values.category.trim(), image, price, promoPrice, badge: values.badge.trim(), description: values.description.trim() };
    try {
      const result = state.editingProduct
        ? await api(`/api/admin/products/${encodeURIComponent(state.editingProduct)}`, { method: "PUT", body: productValues })
        : await api("/api/admin/products", { method: "POST", body: productValues });
      const existingIndex = state.products.findIndex(item => item.id === result.product.id);
      if (existingIndex >= 0) state.products[existingIndex] = result.product;
      else state.products.unshift(result.product);
      state.editingProduct = null;
      renderProducts();
      renderAdmin();
      showToast(existingIndex >= 0 ? "Product updated." : "Product added to your store.");
    } catch (error) { showToast(error.message); }
  } else if (form.id === "settings-form") {
    event.preventDefault();
    try {
      ({ settings: state.settings } = await api("/api/admin/settings", { method: "PUT", body: formObject(form) }));
      renderProducts();
      renderAdmin();
      showToast("Store details saved.");
    } catch (error) { showToast(error.message); }
  } else if (form.id === "newsletter-form") {
    event.preventDefault();
    try {
      await api("/api/newsletter", { method: "POST", body: { email: formObject(form).email } });
      showToast("Thanks for subscribing!");
      form.reset();
    } catch (error) { showToast(error.message); }
  }
});

document.addEventListener("change", async event => {
  if (event.target.id === "sort-products") {
    state.sort = event.target.value;
    renderProducts();
  }
  if (event.target.id === "delivery-country") {
    const form = $("#checkout-form");
    const isNigeria = event.target.value === "NG";
    $("#nigeria-location", form).hidden = !isNigeria;
    $("#delivery-state", form).disabled = !isNigeria;
    $("#delivery-state", form).required = isNigeria;
    $("#international-location", form).hidden = isNigeria || !event.target.value;
    $("#delivery-country-name", form).disabled = isNigeria || !event.target.value;
    $("#delivery-country-name", form).required = event.target.value === "INTL";
    await refreshDeliveryQuote(form);
  }
  if (event.target.id === "delivery-state" || event.target.id === "delivery-country-name") {
    await refreshDeliveryQuote($("#checkout-form"));
  }
  if (event.target.matches("[data-order-status]")) {
    try {
      await api(`/api/admin/orders/${encodeURIComponent(event.target.dataset.orderStatus)}`, { method: "PATCH", body: { status: event.target.value } });
      renderAdmin();
      showToast("Order status updated.");
    } catch (error) { showToast(error.message); }
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !overlay.hidden) closeDrawer();
});
