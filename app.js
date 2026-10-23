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
  const shipping = subtotal >= state.settings.freeShippingThreshold ? 0 : state.settings.shippingFee;
  drawerContent.innerHTML = `${items.map(({ product, quantity }) => `
    <div class="cart-row"><img src="${escapeHTML(product.image)}" alt=""><div><h3>${escapeHTML(product.name)}</h3><div class="price-line">${displayPrice(product)}</div><div class="quantity"><button data-quantity="-1" data-id="${escapeHTML(product.id)}" aria-label="Decrease quantity">−</button><span>${quantity}</span><button data-quantity="1" data-id="${escapeHTML(product.id)}" aria-label="Increase quantity">+</button></div></div><button class="remove-item" data-remove="${escapeHTML(product.id)}">Remove</button></div>`).join("")}
    <div class="cart-summary"><div class="summary-line"><span>Subtotal</span><span>${money(subtotal)}</span></div><div class="summary-line"><span>Shipping</span><span>${shipping ? money(shipping) : "Complimentary"}</span></div><div class="summary-line total"><span>Estimated total</span><span>${money(subtotal + shipping)}</span></div><p class="muted">Taxes, if applicable, are not included in the order total.</p><button class="full-button" data-action="checkout">Continue to checkout</button></div>`;
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
  drawerContent.innerHTML = `<div class="account-card"><strong>${escapeHTML(state.currentUser.name)}</strong><span>${escapeHTML(state.currentUser.email)}</span></div><h3 class="admin-section-title">Your orders</h3>${orders.length ? orders.map(orderCard).join("") : `<p class="muted">Your orders will appear here once you place one.</p>`}<button class="full-button" data-action="signout">Sign out</button>`;
}
function renderSignIn() {
  openDrawer("Welcome back");
  drawerContent.innerHTML = `<div class="admin-tabs"><button class="admin-tab active" data-account-mode="signin">Sign in</button><button class="admin-tab" data-account-mode="signup">Create account</button></div><form class="form-stack" id="account-form" data-mode="signin"><label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label><label>Your name<input name="name" autocomplete="name" placeholder="Your name" hidden></label><label>Password<input name="password" type="password" minlength="12" required autocomplete="current-password" placeholder="At least 12 characters"></label><button class="full-button">Sign in</button></form><p class="form-switch">Use at least 12 characters for a secure password.</p>`;
}
function orderCard(order) {
  return `<div class="order-card"><h3>Order ${escapeHTML(order.reference)}</h3><p>${new Date(order.createdAt).toLocaleDateString()} · ${formatCurrency(order.total, order.currency)}</p><p>Status: ${escapeHTML(order.status)}</p></div>`;
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
  const shipping = subtotal >= state.settings.freeShippingThreshold ? 0 : state.settings.shippingFee;
  openDrawer("Delivery & payment");
  drawerContent.innerHTML = `<div class="notice">Payment is by manual bank transfer. Your order will be marked <strong>awaiting payment</strong> until you confirm the transfer.</div><form class="form-stack" id="checkout-form"><label>Full name<input name="name" required value="${escapeHTML(state.currentUser.name)}" autocomplete="name"></label><label>Delivery address<textarea name="address" required autocomplete="street-address" placeholder="Street, area, city, state"></textarea></label><label>Phone number<input name="phone" required autocomplete="tel" placeholder="+234 800 000 0000"></label><div class="cart-summary"><div class="summary-line"><span>${items.reduce((sum, item) => sum + item.quantity, 0)} items · Subtotal</span><span>${money(subtotal)}</span></div><div class="summary-line"><span>Shipping</span><span>${shipping ? money(shipping) : "Complimentary"}</span></div><div class="summary-line total"><span>Order total</span><span>${money(subtotal + shipping)}</span></div></div><button class="full-button">Place order</button></form><p class="form-switch"><button class="link-button" data-action="back-to-cart">Return to bag</button></p>`;
}
async function completeOrder(values) {
  const { order, bankDetails } = await api("/api/orders", {
    method: "POST",
    body: {
      name: values.name.trim(),
      address: values.address.trim(),
      phone: values.phone.trim(),
      items: state.cart.map(item => ({ productId: item.productId, quantity: item.quantity })),
    },
  });
  state.cart = [];
  persistCart();
  renderPaymentInstructions(order, bankDetails);
}
function renderPaymentInstructions(order, bankDetails) {
  openDrawer("Order received");
  drawerContent.innerHTML = `<div class="notice">Thanks, ${escapeHTML(order.customerName)}. Your order <strong>${escapeHTML(order.reference)}</strong> is reserved while we wait for your transfer.</div><h3 class="admin-section-title">Bank transfer details</h3>${bankDetails ? `<div class="account-card"><span>Bank</span><strong>${escapeHTML(bankDetails.bankName)}</strong><span>Account name</span><strong>${escapeHTML(bankDetails.accountName)}</strong><span>Account number</span><strong>${escapeHTML(bankDetails.accountNumber)}</strong>${bankDetails.instructions ? `<span>Payment note</span><strong>${escapeHTML(bankDetails.instructions)}</strong>` : ""}</div><p class="muted">Use <strong>${escapeHTML(order.reference)}</strong> as your transfer reference. The store owner will confirm your order after the payment is received.</p>` : `<div class="admin-notice">The store owner has not added bank details yet. Your order is saved, but please contact the store owner to arrange payment.</div>`}<div class="order-card"><h3>Order total</h3><p>${formatCurrency(order.total, order.currency)} · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} items</p><p>Delivering to: ${escapeHTML(order.address)}</p></div><button class="full-button" data-action="done">Continue shopping</button>`;
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
  const tabs = ["products", "orders", "settings"];
  drawerContent.innerHTML = `<div class="admin-tabs">${tabs.map(tab => `<button class="admin-tab${state.adminTab === tab ? " active" : ""}" data-admin-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</div><p class="muted">Loading…</p>`;
  try {
    if (state.adminTab === "orders") ({ orders: state.adminOrders } = await api("/api/admin/orders"));
    if (state.adminTab === "settings") ({ settings: state.settings } = await api("/api/admin/settings"));
    drawerContent.innerHTML = `<div class="admin-tabs">${tabs.map(tab => `<button class="admin-tab${state.adminTab === tab ? " active" : ""}" data-admin-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join("")}</div>${state.adminTab === "products" ? renderAdminProducts() : state.adminTab === "orders" ? renderAdminOrders() : renderAdminSettings()}`;
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
  return `<h3 class="admin-section-title">Customer orders (${orders.length})</h3>${orders.length ? orders.map(order => `<div class="admin-order"><div class="admin-order-top"><span>${escapeHTML(order.reference)}</span><span>${formatCurrency(order.total, order.currency)}</span></div><p>${escapeHTML(order.customerName)} · ${escapeHTML(order.customerEmail)}</p><p>${new Date(order.createdAt).toLocaleString()} · ${order.items.map(item => `${escapeHTML(item.name)} × ${item.quantity}`).join(", ")}</p><p>${escapeHTML(order.address)}</p><span class="status-tag">${escapeHTML(order.status)}</span><label class="form-label">Update status<select class="status-select" data-order-status="${escapeHTML(order.reference)}"><option${order.status === "Awaiting payment" ? " selected" : ""}>Awaiting payment</option><option${order.status === "Payment received" ? " selected" : ""}>Payment received</option><option${order.status === "Processing" ? " selected" : ""}>Processing</option><option${order.status === "Shipped" ? " selected" : ""}>Shipped</option><option${order.status === "Completed" ? " selected" : ""}>Completed</option><option${order.status === "Cancelled" ? " selected" : ""}>Cancelled</option></select></label></div>`).join("") : `<p class="muted">Orders placed by customers will appear here.</p>`}`;
}
function renderAdminSettings() {
  return `<h3 class="admin-section-title">Store & payment details</h3><form class="form-stack" id="settings-form"><label>Store name<input name="storeName" required value="${escapeHTML(state.settings.storeName)}"></label><label>Store currency<select name="currency">${["NGN", "USD", "GBP", "EUR", "CAD", "AUD", "KES", "GHS", "INR"].map(currency => `<option${state.settings.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}</select></label><label>Shipping fee<input name="shippingFee" type="number" min="0" step="1" required value="${escapeHTML(state.settings.shippingFee)}"></label><label>Free shipping from<input name="freeShippingThreshold" type="number" min="0" step="1" required value="${escapeHTML(state.settings.freeShippingThreshold)}"></label><label>Bank name<input name="bankName" value="${escapeHTML(state.settings.bankName)}" placeholder="Your bank"></label><label>Account name<input name="accountName" value="${escapeHTML(state.settings.accountName)}" placeholder="Name on the account"></label><label>Account number<input name="accountNumber" value="${escapeHTML(state.settings.accountNumber)}" placeholder="Account number"></label><label>Additional payment instructions<textarea name="instructions" placeholder="Include a payment reference, transfer deadline, etc.">${escapeHTML(state.settings.instructions)}</textarea></label><button class="full-button">Save store details</button></form><p class="form-switch">Bank details are shown only to the customer after an order is placed.</p>`;
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
$("#year").textContent = new Date().getFullYear();
updateCartCount();
api("/api/bootstrap").then(async data => {
  state.products = data.products;
  state.settings = { ...state.settings, ...data.settings };
  state.currentUser = data.user;
  state.csrfToken = data.csrfToken;
  renderProducts();
  if (state.currentUser) {
    try { await restoreAccountCart(); }
    catch (error) { showToast(error.message); }
  }
}).catch(error => {
  console.error("Unable to load the storefront.", error);
  $("#product-grid").innerHTML = `<div class="empty-state"><h3>Store temporarily unavailable</h3><p>${escapeHTML(error.message)} Please refresh the page.</p></div>`;
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
  else if (target.id === "admin-open") {
    event.preventDefault();
    openAdmin();
  } else if (target.matches("[data-category]")) {
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
    try {
      await completeOrder(formObject(form));
    } catch (error) {
      showToast(error.message);
      submitButton.disabled = false;
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
