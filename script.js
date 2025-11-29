/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutine = document.getElementById("generateRoutine");

let currentDisplayedProducts = [];
const selectedProducts = new Map();
let allProducts = null;
// Conversation state for chat follow-ups
const baseSystemMessage = {
  role: "system",
  content:
    "You are an expert skincare routine assistant. Provide clear, helpful answers and consider any previously-shared product list and routine when answering follow-up questions.",
};
let conversation = [baseSystemMessage];
// Flag set when a routine has been successfully generated
let routineGenerated = false;

// Simple on-topic check: keywords and product-name matching (case-insensitive)
const TOPIC_KEYWORDS = [
  "skin",
  "skincare",
  "moistur",
  "cleanser",
  "serum",
  "retinol",
  "sunscreen",
  "spf",
  "hydration",
  "hyaluronic",
  "niacinamide",
  "ceramide",
  "acne",
  "sensitive",
  "oil",
  "dry",
  "hair",
  "shampoo",
  "conditioner",
  "styling",
  "color",
  "makeup",
  "foundation",
  "mascara",
  "fragrance",
  "perfume",
  "scent",
  "routine",
  "step",
  "am",
  "pm",
  "night",
  "morning",
  "ingredient",
];

function isOnTopic(text) {
  if (!text) return false;
  const lower = text.toLowerCase();

  // match any topical keyword
  for (const kw of TOPIC_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }

  // match any selected product name
  for (const p of selectedProducts.values()) {
    if (lower.includes(p.name.toLowerCase())) return true;
  }

  // allow short confirmations/questions that reference the routine implicitly (e.g., "Why?", "How often?")
  const allowShort = ["why", "how", "when", "frequency", "can i", "should i"];
  for (const a of allowShort) {
    if (lower.startsWith(a)) return true;
  }

  return false;
}

/* Persistence: save/load conversation to localStorage for durable history */
const STORAGE_KEY = "loreal.routineConversation.v1";

// Optional: set `window.WORKER_URL` in `secrets.js` to point to your Cloudflare Worker
// e.g. `const WORKER_URL = 'https://your-worker.example.workers.dev';`
const WORKER_URL = window.WORKER_URL || null;

function saveConversationToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
  } catch (e) {
    // ignore storage errors
    console.warn("Failed to save conversation:", e);
  }
}

function loadConversationFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    // ensure base system message present at start
    if (!parsed.length || parsed[0].role !== "system") {
      parsed.unshift(baseSystemMessage);
    }

    conversation = parsed;

    // render non-system messages into the chat window
    chatWindow.innerHTML = "";
    for (const msg of conversation) {
      if (msg.role === "user" || msg.role === "assistant") {
        appendChatMessage(msg.role, msg.content);
      }
    }

    // set routineGenerated if we have any assistant messages
    routineGenerated = conversation.some((m) => m.role === "assistant");
  } catch (e) {
    console.warn("Failed to load conversation:", e);
  }
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Helper to pick random items from an array */
function getRandomItems(array, count) {
  const arr = array.slice();
  const result = [];
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * arr.length);
    result.push(arr.splice(idx, 1)[0]);
  }
  return result;
}

/* On startup, show a small random selection of products in the grid */
async function showRandomProductsOnLoad() {
  try {
    const products = await loadProducts();
    const randoms = getRandomItems(products, 6);
    displayProducts(randoms);
  } catch (err) {
    // keep the placeholder message if loading fails
    console.warn("Failed to load products for initial view", err);
  }
}

/* Load product data from JSON file */
async function loadProducts() {
  if (allProducts) return allProducts;
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  return allProducts;
}

/* Apply combined category + search filters and render matching products */
function applyFilters() {
  const selectedCategory = categoryFilter.value;
  const searchEl = document.getElementById("productSearch");
  const query = searchEl ? searchEl.value.trim().toLowerCase() : "";

  const source = Array.isArray(allProducts)
    ? allProducts
    : currentDisplayedProducts;
  let results = Array.isArray(allProducts)
    ? allProducts.slice()
    : Array.isArray(source)
    ? source.slice()
    : [];

  if (selectedCategory) {
    results = results.filter((p) => p.category === selectedCategory);
  }

  if (query) {
    results = results.filter((p) => {
      const hay = (
        (p.name || "") +
        " " +
        (p.brand || "") +
        " " +
        (p.description || "") +
        " " +
        (p.keywords || "")
      ).toLowerCase();
      return hay.includes(query);
    });
  }

  if (!results || results.length === 0) {
    currentDisplayedProducts = [];
    productsContainer.innerHTML =
      '<div class="placeholder-message">No products found</div>';
  } else {
    displayProducts(results);
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  currentDisplayedProducts = products;

  productsContainer.innerHTML = products
    .map(
      (product) => `
      <div class="product-card" data-id="${product.id}" role="button" tabindex="0" aria-pressed="false">
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3>${product.name}</h3>
          <p>${product.brand}</p>
          <div class="product-desc-wrapper">
            <p id="desc-${product.id}" class="product-desc" aria-hidden="true">${product.description}</p>
            <div class="desc-controls">
              <button class="desc-toggle" aria-controls="desc-${product.id}" aria-expanded="false">Read more</button>
              <button class="details-btn" data-id="${product.id}">Details</button>
            </div>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  attachCardListeners();
  attachDescriptionToggles();
  attachDetailsButtons();
}

/* Attach handlers for description toggle buttons */
function attachDescriptionToggles() {
  const toggles = productsContainer.querySelectorAll(".desc-toggle");
  toggles.forEach((btn) => {
    // stop propagation so clicking the toggle doesn't select the card
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDescription(btn);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        toggleDescription(btn);
      }
    });
  });
}

function attachDetailsButtons() {
  // Ensure a modal exists
  ensureModalExists();

  const details = productsContainer.querySelectorAll(".details-btn");
  details.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const product = currentDisplayedProducts.find((p) => p.id === id);
      if (product) openModal(product);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const product = currentDisplayedProducts.find((p) => p.id === id);
        if (product) openModal(product);
      }
    });
  });
}

/* Modal implementation */
let modalEl = null;
let lastFocusedElement = null;

function ensureModalExists() {
  if (modalEl) return;
  modalEl = document.createElement("div");
  modalEl.id = "productModal";
  modalEl.className = "modal hidden";
  modalEl.innerHTML = `
    <div class="modal-overlay" tabindex="-1"></div>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <button class="modal-close" aria-label="Close details">✕</button>
      <div class="modal-content">
        <img class="modal-image" src="" alt=""/>
        <div class="modal-body">
          <h3 id="modalTitle"></h3>
          <p class="modal-brand"></p>
          <p class="modal-desc"></p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // handlers
  const closeBtn = modalEl.querySelector(".modal-close");
  closeBtn.addEventListener("click", closeModal);

  const overlay = modalEl.querySelector(".modal-overlay");
  overlay.addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (!modalEl) return;
    if (e.key === "Escape" && !modalEl.classList.contains("hidden")) {
      closeModal();
    }
  });
}

function openModal(product) {
  ensureModalExists();
  lastFocusedElement = document.activeElement;

  const img = modalEl.querySelector(".modal-image");
  const title = modalEl.querySelector("#modalTitle");
  const brand = modalEl.querySelector(".modal-brand");
  const desc = modalEl.querySelector(".modal-desc");

  img.src = product.image;
  img.alt = product.name;
  title.textContent = product.name;
  brand.textContent = product.brand;
  desc.textContent = product.description;

  modalEl.classList.remove("hidden");
  // focus close button
  const closeBtn = modalEl.querySelector(".modal-close");
  closeBtn.focus();
}

function closeModal() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  if (lastFocusedElement) lastFocusedElement.focus();
}

function toggleDescription(button) {
  const descId = button.getAttribute("aria-controls");
  const desc = document.getElementById(descId);
  if (!desc) return;

  const expanded = button.getAttribute("aria-expanded") === "true";
  if (expanded) {
    button.setAttribute("aria-expanded", "false");
    desc.classList.remove("expanded");
    desc.setAttribute("aria-hidden", "true");
    button.textContent = "Read more";
  } else {
    button.setAttribute("aria-expanded", "true");
    desc.classList.add("expanded");
    desc.setAttribute("aria-hidden", "false");
    button.textContent = "Show less";
  }
}

/* Attach click and keyboard handlers to each card */
function attachCardListeners() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    card.addEventListener("click", () => toggleCardSelection(card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleCardSelection(card);
      }
    });
  });
}

function toggleCardSelection(card) {
  const id = Number(card.dataset.id);

  if (selectedProducts.has(id)) {
    selectedProducts.delete(id);
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  } else {
    const product = currentDisplayedProducts.find((p) => p.id === id);
    if (!product) return;
    selectedProducts.set(id, product);
    card.classList.add("selected");
    card.setAttribute("aria-pressed", "true");
  }

  renderSelectedProducts();
}

function renderSelectedProducts() {
  if (selectedProducts.size === 0) {
    selectedProductsList.innerHTML =
      '<div class="placeholder-message">No products selected</div>';
    generateRoutine.disabled = true;
    generateRoutine.style.opacity = "0.6";
    return;
  }

  generateRoutine.disabled = false;
  generateRoutine.style.opacity = "1";

  selectedProductsList.innerHTML = Array.from(selectedProducts.values())
    .map(
      (p) =>
        `<div class="selected-chip" data-id="${p.id}">
          <span class="chip-name">${p.name}</span>
          <button class="remove-btn" aria-label="Remove ${p.name}" data-id="${p.id}">&times;</button>
        </div>`
    )
    .join("");

  // Attach handlers to remove buttons so removing a chip also unselects the card
  const removeButtons = selectedProductsList.querySelectorAll(".remove-btn");
  removeButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = Number(btn.dataset.id);
      removeSelectedProduct(id);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const id = Number(btn.dataset.id);
        removeSelectedProduct(id);
      }
    });
  });

  // Make the chip itself removable by click or keyboard (Enter/Space)
  const chips = selectedProductsList.querySelectorAll(".selected-chip");
  chips.forEach((chip) => {
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.addEventListener("click", (e) => {
      // if click was on the remove button, its handler will run; otherwise remove
      const target = e.target;
      if (target.classList.contains("remove-btn")) return;
      const id = Number(chip.dataset.id);
      removeSelectedProduct(id);
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const id = Number(chip.dataset.id);
        removeSelectedProduct(id);
      }
    });
  });
}

function removeSelectedProduct(id) {
  if (!selectedProducts.has(id)) return;
  selectedProducts.delete(id);

  // Update corresponding card in the grid if present
  const card = productsContainer.querySelector(
    `.product-card[data-id="${id}"]`
  );
  if (card) {
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  }

  renderSelectedProducts();
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const selectedCategory = e.target.value;
  if (!allProducts) await loadProducts();
  applyFilters();
});

// Wire up live search input to filter as the user types
const searchInput = document.getElementById("productSearch");
const clearSearchBtn = document.getElementById("clearSearch");
if (searchInput) {
  const updateClearVisibility = () => {
    if (!clearSearchBtn) return;
    if (searchInput.value && searchInput.value.trim() !== "") {
      clearSearchBtn.classList.remove("hidden");
    } else {
      clearSearchBtn.classList.add("hidden");
    }
  };

  searchInput.addEventListener("input", () => {
    if (!allProducts) {
      loadProducts().then(() => applyFilters());
    } else {
      applyFilters();
    }
    updateClearVisibility();
  });

  // initialize visibility on load
  updateClearVisibility();

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      applyFilters();
      searchInput.focus();
      updateClearVisibility();
    });
  }
}

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const userText = input.value.trim();
  if (!userText) return;

  // enforce on-topic follow-ups: only allow questions about the routine or related topics
  if (!isOnTopic(userText)) {
    appendChatMessage(
      "assistant",
      "Please ask questions related to the generated routine or to topics like skincare, haircare, makeup, or fragrance."
    );
    return;
  }

  // append user message locally and to conversation
  appendChatMessage("user", userText);
  conversation.push({ role: "user", content: userText });
  saveConversationToStorage();

  // get API key
  // choose whether to send via a server-side worker (preferred) or direct to OpenAI
  const preferWorker = !!WORKER_URL;
  const enableWebSearchEl = document.getElementById("enableWebSearch");
  const includeWeb = !!(enableWebSearchEl && enableWebSearchEl.checked);

  // show a small assistant placeholder
  appendChatMessage("assistant", "Thinking...");

  try {
    let res;
    if (preferWorker) {
      // Send to the proxied worker (no client API key required)
      res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: conversation,
          max_tokens: 600,
          temperature: 0.7,
          include_web_results: includeWeb,
          web_queries: includeWeb ? [userText] : undefined,
        }),
      });
    } else {
      // fallback to direct OpenAI call using a local key (secrets.js)
      const apiKey =
        window.OPENAI_API_KEY ||
        (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) ||
        null;
      if (!apiKey) {
        appendChatMessage(
          "assistant",
          'OpenAI API key not found. Create a `secrets.js` that sets `const OPENAI_API_KEY = "sk-...";` and include it before `script.js`.'
        );
        input.value = "";
        return;
      }

      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: conversation,
          max_tokens: 600,
          temperature: 0.7,
        }),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      appendChatMessage(
        "assistant",
        `API error: ${res.status} ${res.statusText} - ${escapeHtml(errText)}`
      );
      return;
    }

    const data = await res.json();
    const assistantText =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "No response from the API.";
    // push assistant reply into conversation so follow-ups have context
    conversation.push({ role: "assistant", content: assistantText });
    saveConversationToStorage();
    appendChatMessage("assistant", assistantText);
    // mark that a routine has been generated successfully
    routineGenerated = true;
  } catch (err) {
    appendChatMessage(
      "assistant",
      `Request failed: ${escapeHtml(String(err))}`
    );
  } finally {
    input.value = "";
  }
});

/* Generate Routine button: collect selected products and call OpenAI */
generateRoutine.addEventListener("click", async (e) => {
  e.preventDefault();

  const products = Array.from(selectedProducts.values()).map((p) => ({
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
  }));

  if (products.length === 0) {
    appendChatMessage(
      "assistant",
      "Please select one or more products before generating a routine."
    );
    return;
  }

  // Determine API key: expect the page to expose `OPENAI_API_KEY` (e.g. in secrets.js)
  const apiKey =
    window.OPENAI_API_KEY ||
    (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) ||
    null;
  if (!apiKey) {
    appendChatMessage(
      "assistant",
      'OpenAI API key not found. Create a `secrets.js` that sets `const OPENAI_API_KEY = "sk-...";` and include it before `script.js`.'
    );
    return;
  }

  // Build the routine request and seed the conversation
  const userMessage = {
    role: "user",
    content: `Selected products (JSON):\n${JSON.stringify(
      products,
      null,
      2
    )}\n\nPlease produce a concise, step-by-step routine tailored to these products.`,
  };

  // ensure base system message is present, then append this products payload
  if (conversation.length === 0) conversation = [baseSystemMessage];
  // if the conversation already contains the same products payload as last message, avoid duplicating
  const last = conversation[conversation.length - 1];
  if (!last || last.content !== userMessage.content) {
    conversation.push(userMessage);
  }
  appendChatMessage("user", "Generating routine for selected products...");

  try {
    const preferWorker = !!WORKER_URL;
    const enableWebSearchEl = document.getElementById("enableWebSearch");
    const includeWeb = !!(enableWebSearchEl && enableWebSearchEl.checked);

    let res;
    if (preferWorker) {
      // web queries: use selected product names to fetch fresh info if enabled
      const webQueries = includeWeb
        ? Array.from(selectedProducts.values()).map((p) => p.name)
        : undefined;

      res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: conversation,
          max_tokens: 700,
          temperature: 0.7,
          include_web_results: includeWeb,
          web_queries: webQueries,
        }),
      });
    } else {
      // fallback to direct OpenAI call
      const apiKey =
        window.OPENAI_API_KEY ||
        (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY) ||
        null;
      if (!apiKey) {
        appendChatMessage(
          "assistant",
          'OpenAI API key not found. Create a `secrets.js` that sets `const OPENAI_API_KEY = "sk-...";` and include it before `script.js`.'
        );
        return;
      }

      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: conversation,
          max_tokens: 700,
          temperature: 0.7,
        }),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      appendChatMessage(
        "assistant",
        `OpenAI API error: ${res.status} ${res.statusText} - ${escapeHtml(
          errText
        )}`
      );
      return;
    }

    const data = await res.json();
    const assistantText =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "No response from OpenAI.";
    // push assistant reply into conversation so follow-ups have context
    conversation.push({ role: "assistant", content: assistantText });
    appendChatMessage("assistant", assistantText);
    // mark that a routine has been generated successfully
    routineGenerated = true;
  } catch (err) {
    appendChatMessage(
      "assistant",
      `Request failed: ${escapeHtml(String(err))}`
    );
  }
});

/* Helpers to render chat messages */
function appendChatMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-${role}`;
  wrapper.innerText = text;
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Load any saved conversation on startup
loadConversationFromStorage();

// Show a random set of products in the placeholder area on initial load
showRandomProductsOnLoad();

/* Clear conversation button handler */
const clearBtn = document.getElementById("clearConversationBtn");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    // snapshot previous state for undo
    const previousConversation = JSON.parse(JSON.stringify(conversation || []));
    const previousSelected = Array.from(selectedProducts.values()).map((p) => ({
      ...p,
    }));

    // remove persisted conversation
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to remove conversation from storage", e);
    }

    // reset in-memory conversation and UI
    conversation = [baseSystemMessage];
    routineGenerated = false;

    // clear selected products and update grid/UI
    selectedProducts.clear();
    // un-highlight any selected cards
    const cards = productsContainer.querySelectorAll(".product-card.selected");
    cards.forEach((card) => {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    });
    renderSelectedProducts();

    // clear chat window and show cleared message
    chatWindow.innerHTML = "";
    appendChatMessage("assistant", "Conversation cleared.");

    // create a temporary undo button in the chat-controls area
    const controls = document.querySelector(".chat-controls");
    if (controls) {
      let undoBtn = document.getElementById("undoClearBtn");
      if (!undoBtn) {
        undoBtn = document.createElement("button");
        undoBtn.id = "undoClearBtn";
        undoBtn.className = "undo-btn";
        undoBtn.type = "button";
        undoBtn.textContent = "Undo";
        controls.appendChild(undoBtn);

        // restore handler
        const undoHandler = () => {
          // restore conversation and selected products
          try {
            conversation = previousConversation.length
              ? previousConversation
              : [baseSystemMessage];
            // restore selectedProducts map
            selectedProducts.clear();
            for (const p of previousSelected) {
              selectedProducts.set(p.id, p);
            }

            // persist restored conversation
            saveConversationToStorage();

            // re-render chat window and selected list
            chatWindow.innerHTML = "";
            for (const msg of conversation) {
              if (msg.role === "user" || msg.role === "assistant")
                appendChatMessage(msg.role, msg.content);
            }
            renderSelectedProducts();

            // remove undo button
            undoBtn.removeEventListener("click", undoHandler);
            if (undoBtn.parentNode) undoBtn.parentNode.removeChild(undoBtn);
          } catch (err) {
            console.warn("Failed to undo clear:", err);
          }
        };

        undoBtn.addEventListener("click", undoHandler);

        // auto-remove undo button after 10 seconds
        setTimeout(() => {
          if (undoBtn && undoBtn.parentNode)
            undoBtn.parentNode.removeChild(undoBtn);
        }, 10000);
      }
    }
  });
}
