// Estado Global da Aplicação
const state = {
  currentUser: null,
  token: localStorage.getItem("token") || null,
  services: [],
  selectedService: null,
  selectedDate: null,
  selectedSchedule: null,
  currentView: "home",
  quickHoursSelected: new Set(["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"])
};

// Funções Auxiliares de API
async function apiRequest(endpoint, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(endpoint, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Ocorreu um erro na requisição.");
    }
    return data;
  } catch (error) {
    showToast(error.message, "error");
    throw error;
  }
}

// Notificações Toast
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "ℹ️";
  if (type === "success") icon = "✅";
  if (type === "error") icon = "⚠️";

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Formatação
function formatCurrency(val) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
}

function formatDateBR(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
  setupDatesDefault();
  renderQuickHoursPills();
  await checkAuth();
  await loadServices();
  await loadContact();
  updateNavUI();
});

async function loadContact() {
  try {
    const data = await apiRequest("/api/contact");
    state.contactPhone = sanitizePhone(data.phone);
  } catch (e) {
    state.contactPhone = "";
  }
}

function whatsappLink(message) {
  let phone = state.contactPhone || "";
  if (!phone) {
    return `javascript:showToast('O WhatsApp da profissional ainda não foi cadastrado.', 'error')`;
  }
  if (phone.length <= 11) phone = "55" + phone;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function setupDatesDefault() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // Data mínima para agendamento é hoje
  const dateInput = document.getElementById("booking-date-input");
  if (dateInput) {
    dateInput.min = todayStr;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomY = tomorrow.getFullYear();
    const tomM = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const tomD = String(tomorrow.getDate()).padStart(2, "0");
    dateInput.value = `${tomY}-${tomM}-${tomD}`;
    state.selectedDate = dateInput.value;
  }

  const supDateInput = document.getElementById("supervisor-add-date");
  if (supDateInput) {
    supDateInput.value = todayStr;
  }
  renderMultiCalendar();
}

// Autenticação
async function checkAuth() {
  if (!state.token) {
    state.currentUser = null;
    updateNavUI();
    return;
  }

  try {
    const data = await apiRequest("/api/auth/me");
    state.currentUser = data.user;
  } catch (err) {
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem("token");
  }
  updateNavUI();
}

function updateNavUI() {
  const loggedOutGroup = document.getElementById("auth-actions-logged-out");
  const loggedInGroup = document.getElementById("auth-actions-logged-in");
  const myAppBtn = document.getElementById("nav-btn-my-appointments");
  const supBtn = document.getElementById("nav-btn-supervisor");
  const nameLabel = document.getElementById("user-display-name");
  const roleLabel = document.getElementById("user-display-role");

  if (state.currentUser) {
    loggedOutGroup.classList.add("hidden");
    loggedInGroup.classList.remove("hidden");
    nameLabel.textContent = state.currentUser.name.split(" ")[0];

    if (state.currentUser.role === "supervisor") {
      roleLabel.textContent = "Supervisora 👑";
      roleLabel.style.background = "#b47a61";
      supBtn.classList.remove("hidden");
      myAppBtn.classList.add("hidden");
    } else {
      roleLabel.textContent = "Cliente";
      roleLabel.style.background = "#827874";
      supBtn.classList.add("hidden");
      myAppBtn.classList.remove("hidden");
    }
  } else {
    loggedOutGroup.classList.remove("hidden");
    loggedInGroup.classList.add("hidden");
    myAppBtn.classList.add("hidden");
    supBtn.classList.add("hidden");
  }
}

// Modais
function openLoginModal() {
  document.getElementById("modal-login").classList.add("active");
  document.getElementById("modal-register").classList.remove("active");
}

function openRegisterModal() {
  document.getElementById("modal-register").classList.add("active");
  document.getElementById("modal-login").classList.remove("active");
}

function closeModals() {
  document.getElementById("modal-login").classList.remove("active");
  document.getElementById("modal-register").classList.remove("active");
}

function fillDemoUser(username, password) {
  document.getElementById("login-username").value = username;
  document.getElementById("login-password").value = password;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  try {
    const data = await apiRequest("/api/auth/login", "POST", { username, password });
    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem("token", data.token);
    
    closeModals();
    updateNavUI();
    showToast(`Bem-vinda(o), ${data.user.name}!`, "success");

    if (data.user.role === "supervisor") {
      switchView("supervisor");
    } else {
      if (state.currentView === "book") {
        updateBookingSummary();
      }
    }
  } catch (e) {}
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("reg-name").value;
  const username = document.getElementById("reg-username").value;
  const phone = document.getElementById("reg-phone").value;
  const password = document.getElementById("reg-password").value;

  try {
    const data = await apiRequest("/api/auth/register", "POST", { name, username, phone, password });
    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem("token", data.token);

    closeModals();
    updateNavUI();
    showToast(`Cadastro realizado com sucesso! Bem-vinda, ${data.user.name}.`, "success");

    if (state.currentView === "book") {
      updateBookingSummary();
    }
  } catch (e) {}
}

function handleLogout() {
  if (confirm("Deseja realmente sair da sua conta?")) {
    apiRequest("/api/auth/logout", "POST").catch(() => {});
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem("token");
    updateNavUI();
    switchView("home");
    showToast("Você saiu com segurança.", "info");
  }
}

// Navegação entre Vistas
function switchView(viewName) {
  state.currentView = viewName;
  const views = ["home", "book", "my-appointments", "supervisor"];
  
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const navBtn = document.getElementById(`nav-btn-${v}`);
    if (el) {
      if (v === viewName) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
    if (navBtn) {
      if (v === viewName) {
        navBtn.classList.add("active");
      } else {
        navBtn.classList.remove("active");
      }
    }
  });

  const hero = document.getElementById("hero-banner");
  if (viewName === "home") {
    hero.classList.remove("hidden");
  } else {
    hero.classList.add("hidden");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viewName === "book") {
    initBookingView();
  } else if (viewName === "my-appointments") {
    loadMyAppointments();
  } else if (viewName === "supervisor") {
    if (!state.currentUser || state.currentUser.role !== "supervisor") {
      showToast("Acesso restrito ao supervisor.", "error");
      openLoginModal();
      switchView("home");
      return;
    }
    initSupervisorView();
  }
}

function scrollToServices() {
  const el = document.getElementById("services-section");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

// Catálogo de Serviços
async function loadServices() {
  try {
    const services = await apiRequest("/api/services");
    state.services = services;
    renderServicesHome(services);
    renderBookingServices(services);
  } catch (e) {}
}

function renderServicesHome(services) {
  const container = document.getElementById("services-list");
  if (!container) return;

  if (services.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--gray-muted);">Nenhum serviço disponível no momento.</div>`;
    return;
  }

  container.innerHTML = services.map(s => `
    <div class="service-card" onclick="selectServiceAndBook(${s.id})">
      <div>
        <div class="service-header">
          <h3 class="service-name">${s.name}</h3>
          <span class="service-price">${formatCurrency(s.price)}</span>
        </div>
        <p class="service-desc">${s.description || ""}</p>
      </div>
      <div class="service-meta">
        <span class="service-duration">⏱️ Duração: ~${s.duration_minutes} min</span>
        <button class="btn btn-outline-primary btn-sm" onclick="event.stopPropagation(); selectServiceAndBook(${s.id})">
          Agendar ✨
        </button>
      </div>
    </div>
  `).join("");
}

function selectServiceAndBook(serviceId) {
  const serv = state.services.find(s => s.id === serviceId);
  if (serv) {
    state.selectedService = serv;
  }
  switchView("book");
  highlightSelectedServiceCard();
  updateBookingSummary();
}

// Agendamento (Fluxo do Cliente)
function initBookingView() {
  if (!state.selectedService && state.services.length > 0) {
    state.selectedService = state.services[0];
  }
  highlightSelectedServiceCard();
  onBookingDateChange();
}

function renderBookingServices(services) {
  const container = document.getElementById("booking-services-selector");
  if (!container) return;

  container.innerHTML = services.map(s => `
    <div class="service-card ${state.selectedService && state.selectedService.id === s.id ? 'selected' : ''}" 
         id="book-serv-${s.id}" 
         onclick="chooseServiceForBooking(${s.id})">
      <div class="service-header">
        <h4 class="service-name">${s.name}</h4>
        <span class="service-price">${formatCurrency(s.price)}</span>
      </div>
      <div class="service-meta" style="margin-top: 0.5rem; border-top: none; padding-top: 0;">
        <span style="font-size: 0.8rem; color: var(--gray-muted);">⏱️ ${s.duration_minutes} min</span>
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--primary);">Selecionar</span>
      </div>
    </div>
  `).join("");
}

function chooseServiceForBooking(serviceId) {
  const serv = state.services.find(s => s.id === serviceId);
  if (serv) {
    state.selectedService = serv;
    highlightSelectedServiceCard();
    updateBookingSummary();
  }
}

function highlightSelectedServiceCard() {
  if (!state.selectedService) return;
  document.querySelectorAll("#booking-services-selector .service-card").forEach(el => {
    el.classList.remove("selected");
  });
  const currentCard = document.getElementById(`book-serv-${state.selectedService.id}`);
  if (currentCard) {
    currentCard.classList.add("selected");
  }
}

async function onBookingDateChange() {
  const dateInput = document.getElementById("booking-date-input");
  state.selectedDate = dateInput.value;
  state.selectedSchedule = null;
  updateBookingSummary();

  const slotsContainer = document.getElementById("booking-slots-container");
  slotsContainer.innerHTML = `<div class="slots-empty" style="grid-column: 1 / -1;">Verificando horários autorizados pela supervisora...</div>`;

  if (!state.selectedDate) {
    slotsContainer.innerHTML = `<div class="slots-empty" style="grid-column: 1 / -1;">Por favor, selecione uma data válida.</div>`;
    return;
  }

  try {
    const slots = await apiRequest(`/api/schedules/available?date=${state.selectedDate}`);
    renderAvailableSlots(slots);
  } catch (err) {
    slotsContainer.innerHTML = `<div class="slots-empty" style="grid-column: 1 / -1; color: var(--danger);">Não foi possível carregar os horários.</div>`;
  }
}

function renderAvailableSlots(slots) {
  const container = document.getElementById("booking-slots-container");
  
  // Se não há horários autorizados pelo supervisor (ou se todos foram reservados)
  if (!slots || slots.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: #fff7ed; border: 1.5px solid #fed7aa; border-radius: var(--radius-sm); padding: 1.75rem; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⛔</div>
        <strong style="color: #9a3412; font-size: 1.05rem; display: block; margin-bottom: 0.4rem;">
          Todos os horários estão INDISPONÍVEIS para esta data (${formatDateBR(state.selectedDate)})
        </strong>
        <p style="color: #7c2d12; font-size: 0.88rem; max-width: 520px; margin: 0 auto 1.25rem; line-height: 1.5;">
          A supervisora ainda não autorizou horários para o dia selecionado. Conforme a regra de atendimento, os horários só ficam disponíveis após liberação da designer.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
          <a href="${whatsappLink(`Olá ANA CAROLINA BEAUTY, gostaria de saber se há previsão de horários para o dia ${state.selectedDate}`)}" 
             target="_blank" 
             class="btn btn-outline-primary btn-sm">
            💬 Solicitar Horário no WhatsApp
          </a>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = slots.map(slot => `
    <div class="slot-chip" id="slot-${slot.id}" onclick="selectSlot(${slot.id}, '${slot.time}')">
      ${slot.time}
    </div>
  `).join("");
}

function selectSlot(slotId, time) {
  state.selectedSchedule = { id: slotId, time: time };
  
  document.querySelectorAll(".slot-chip").forEach(el => el.classList.remove("selected"));
  const chosenEl = document.getElementById(`slot-${slotId}`);
  if (chosenEl) chosenEl.classList.add("selected");

  updateBookingSummary();
}

function updateBookingSummary() {
  const nameEl = document.getElementById("summary-service-name");
  const durEl = document.getElementById("summary-service-duration");
  const dateEl = document.getElementById("summary-date");
  const timeEl = document.getElementById("summary-time");
  const priceEl = document.getElementById("summary-total-price");

  if (state.selectedService) {
    nameEl.textContent = state.selectedService.name;
    durEl.textContent = `~${state.selectedService.duration_minutes} minutos`;
    priceEl.textContent = formatCurrency(state.selectedService.price);
  } else {
    nameEl.textContent = "Não selecionado";
    durEl.textContent = "-";
    priceEl.textContent = "R$ 0,00";
  }

  dateEl.textContent = state.selectedDate ? formatDateBR(state.selectedDate) : "-";
  timeEl.textContent = state.selectedSchedule ? state.selectedSchedule.time : "Selecione um horário";
}

async function submitBooking() {
  if (!state.selectedService) {
    showToast("Por favor, selecione um procedimento.", "error");
    return;
  }
  if (!state.selectedDate) {
    showToast("Por favor, selecione a data do agendamento.", "error");
    return;
  }
  if (!state.selectedSchedule) {
    showToast("Por favor, selecione um horário autorizado disponível.", "error");
    return;
  }

  if (!state.currentUser) {
    showToast("Você precisa entrar ou se cadastrar para concluir o agendamento.", "info");
    openLoginModal();
    return;
  }

  const observation = document.getElementById("booking-observation").value.slice(0, 200);
  const btn = document.getElementById("btn-confirm-booking");
  btn.disabled = true;
  btn.textContent = "Enviando agendamento...";

  try {
    const payload = {
      service_id: state.selectedService.id,
      schedule_id: state.selectedSchedule.id,
      observation: observation
    };

    const res = await apiRequest("/api/appointments", "POST", payload);
    showToast("🎉 Agendamento solicitado! Aguarde a confirmação da supervisora.", "success");

    document.getElementById("booking-observation").value = "";
    document.getElementById("booking-observation-count").textContent = "0";
    state.selectedSchedule = null;
    
    if (state.currentUser.role === "supervisor") {
      switchView("supervisor");
    } else {
      switchView("my-appointments");
    }
  } catch (err) {
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar Agendamento ✨";
  }
}

// Meus Agendamentos (Cliente)
async function loadMyAppointments() {
  const container = document.getElementById("my-appointments-list");
  container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--gray-muted);">Carregando agendamentos...</div>`;

  try {
    const list = await apiRequest("/api/appointments/my");
    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3rem 1.5rem;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">📅</div>
          <h3>Você ainda não possui agendamentos</h3>
          <p style="color: var(--gray-muted); margin-bottom: 1.5rem;">Escolha um procedimento e garanta o seu horário exclusivo com nossa designer.</p>
          <button class="btn btn-primary" onclick="switchView('book')">Agendar Agora</button>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="card" style="padding: 1.25rem 1.5rem; margin-bottom: 1rem; border-left: 4px solid var(--primary);">
        <div class="flex-between" style="flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.75rem;">
          <div>
            <h3 style="font-size: 1.15rem; margin-bottom: 0.2rem;">${item.service_name}</h3>
            <span style="font-size: 0.88rem; color: var(--dark-soft); font-weight: 600;">
              🗓️ ${formatDateBR(item.date)} às ⏰ ${item.time}
            </span>
          </div>
          <div>
            ${renderStatusBadge(item.status)}
          </div>
        </div>

        ${item.observation ? `
          <div class="observation-box">
            <strong>Sua Observação:</strong> ${escapeHtml(item.observation)}
          </div>
        ` : ''}

        <div class="flex-between" style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px dashed var(--gray-border); flex-wrap: wrap; gap: 0.5rem;">
          <span style="font-size: 0.95rem; font-weight: 700; color: var(--primary);">
            Valor: ${formatCurrency(item.service_price)}
          </span>
          <div class="flex-gap">
            <a href="${whatsappLink(`Olá ANA CAROLINA BEAUTY, tenho uma dúvida sobre meu agendamento de ${item.service_name} no dia ${item.date} às ${item.time}`)}" 
               target="_blank" 
               class="btn btn-secondary btn-sm" style="color: #2e7d32;">
              💬 Falar no WhatsApp
            </a>
            ${(item.status === 'pendente' || item.status === 'confirmado') ? `
              <button class="btn btn-danger btn-sm" onclick="cancelClientAppointment(${item.id})">
                Cancelar Agendamento
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `).join("");

  } catch (err) {
    container.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao carregar agendamentos.</div>`;
  }
}

async function cancelClientAppointment(appointmentId) {
  if (!confirm("Tem certeza que deseja cancelar este agendamento? O horário será liberado novamente.")) {
    return;
  }

  try {
    await apiRequest(`/api/appointments/${appointmentId}/cancel`, "POST");
    showToast("Agendamento cancelado com sucesso.", "info");
    loadMyAppointments();
  } catch (e) {}
}

// ==========================================
// PAINEL DO SUPERVISOR
// ==========================================
function initSupervisorView() {
  loadSupervisorAppointments();
  loadSupervisorSchedulesList();
}

function switchSupervisorSubtab(subtab) {
  ["appointments", "schedules", "services", "clients"].forEach(name => {
    document.getElementById(`supervisor-subtab-${name}`).classList.toggle("hidden", name !== subtab);
    document.getElementById(`subtab-btn-${name}`).classList.toggle("active", name === subtab);
  });
  if (subtab === "appointments") loadSupervisorAppointments();
  else if (subtab === "schedules") loadSupervisorSchedulesList();
  else if (subtab === "clients") loadSupervisorClients();
  else renderSupervisorServices();
}

function renderSupervisorServices() {
  const el = document.getElementById("supervisor-services-list");
  if (!el) return;
  if (!state.services.length) {
    el.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--gray-muted);">Nenhum serviço cadastrado.</div>`;
    return;
  }
  el.innerHTML = state.services.map(s => `
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.85rem 0; border-bottom: 1px solid var(--gray-border);">
      <div>
        <strong>${escapeHtml(s.name)}</strong> — ${formatCurrency(s.price)} • ~${s.duration_minutes} min<br>
        <span style="font-size: 0.85rem; color: var(--gray-muted);">${escapeHtml(s.description) || "<em>Sem observações</em>"}</span>
      </div>
      <div class="flex-gap">
        <button class="btn btn-secondary btn-sm" onclick="openServiceModal(${s.id})">✏️ Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id})">🗑️</button>
      </div>
    </div>
  `).join("");
}

function openServiceModal(id) {
  const s = id ? state.services.find(x => x.id === id) : null;
  document.getElementById("service-modal-title").textContent = s ? "Editar Serviço" : "Novo Serviço";
  document.getElementById("service-edit-id").value = s ? s.id : "";
  document.getElementById("service-name").value = s ? s.name : "";
  document.getElementById("service-price").value = s ? s.price : "";
  document.getElementById("service-duration").value = s ? s.duration_minutes : 30;
  document.getElementById("service-desc").value = s ? (s.description || "") : "";
  document.getElementById("modal-service").classList.add("active");
}

function closeServiceModal() {
  document.getElementById("modal-service").classList.remove("active");
}

async function saveService() {
  const id = document.getElementById("service-edit-id").value;
  const body = {
    name: document.getElementById("service-name").value.trim(),
    price: parseFloat(document.getElementById("service-price").value),
    duration_minutes: parseInt(document.getElementById("service-duration").value, 10),
    description: document.getElementById("service-desc").value.trim()
  };
  if (!body.name || isNaN(body.price) || isNaN(body.duration_minutes)) {
    showToast("Preencha nome, valor e duração.", "error");
    return;
  }
  try {
    const res = id
      ? await apiRequest(`/api/supervisor/services/${id}`, "PUT", body)
      : await apiRequest("/api/supervisor/services", "POST", body);
    showToast(res.message, "success");
    closeServiceModal();
    state.selectedService = null;
    await loadServices();
    renderSupervisorServices();
  } catch (e) {}
}

async function deleteService(id) {
  if (!confirm("Excluir este serviço?")) return;
  try {
    const res = await apiRequest(`/api/supervisor/services/${id}`, "DELETE");
    showToast(res.message, "success");
    state.selectedService = null;
    await loadServices();
    renderSupervisorServices();
  } catch (e) {}
}
async function loadSupervisorAppointments() {
  const tbody = document.getElementById("supervisor-appointments-tbody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem;">Carregando agendamentos...</td></tr>`;

  const statusFilter = document.getElementById("supervisor-filter-status").value;
  const dateFilter = document.getElementById("supervisor-filter-date").value;

  let query = [];
  if (statusFilter && statusFilter !== "todos") query.push(`status=${statusFilter}`);
  if (dateFilter) query.push(`date=${dateFilter}`);
  const queryString = query.length ? `?${query.join("&")}` : "";

  try {
    const list = await apiRequest(`/api/supervisor/appointments${queryString}`);
    updateSupervisorStats();

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--gray-muted);">Nenhum agendamento encontrado para os filtros selecionados.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td>
          <strong>${formatDateBR(item.date)}</strong><br>
          <span style="font-size: 1.1rem; color: var(--primary); font-weight: 700;">⏰ ${item.time}</span>
        </td>
        <td>
          <strong>${item.client_name}</strong><br>
          <small style="color: var(--gray-muted);">Usuário: ${item.client_username}</small><br>
          <a class="whatsapp-link" href="https://wa.me/55${sanitizePhone(item.client_phone)}?text=Ol%C3%A1%20${encodeURIComponent(item.client_name)}%2C%20falo%20do%20ANA%20CAROLINA%20BEAUTY%20sobre%20seu%20agendamento!" target="_blank">
            📱 ${item.client_phone || 'Sem telefone'}
          </a>
        </td>
        <td>
          <strong>${item.service_name}</strong><br>
          <span style="font-size: 0.85rem; color: var(--gray-muted);">${formatCurrency(item.service_price)} • ~${item.duration_minutes}m</span>
        </td>
        <td>
          ${item.observation ? `
            <div class="observation-box" style="margin: 0;">
              📝 <em>"${escapeHtml(item.observation)}"</em>
            </div>
          ` : `
            <span style="color: var(--gray-muted); font-size: 0.85rem; font-style: italic;">Nenhuma observação informada</span>
          `}
        </td>
        <td>
          ${renderStatusBadge(item.status)}
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end; flex-wrap: wrap;">
            ${item.status === 'pendente' ? `
              <button class="btn btn-success btn-sm" onclick="updateAppointmentStatus(${item.id}, 'confirmado')" title="Confirmar este agendamento">
                ✅ Confirmar
              </button>
            ` : ''}

            ${item.status === 'confirmado' ? `
              <button class="btn btn-secondary btn-sm" onclick="updateAppointmentStatus(${item.id}, 'concluido')" title="Marcar atendimento como realizado">
                ✔️ Concluir
              </button>
            ` : ''}

            ${(item.status === 'pendente' || item.status === 'confirmado') ? `
              <button class="btn btn-danger btn-sm" onclick="updateAppointmentStatus(${item.id}, 'cancelado')" title="Recusar ou cancelar este agendamento">
                ❌ Cancelar
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 2rem;">Erro ao carregar lista de agendamentos.</td></tr>`;
  }
}

function updateSupervisorStats() {
  apiRequest("/api/supervisor/appointments").then(fullList => {
    const pending = fullList.filter(a => a.status === "pendente").length;
    const confirmed = fullList.filter(a => a.status === "confirmado").length;
    
    document.getElementById("stat-pending-count").textContent = pending;
    document.getElementById("stat-confirmed-count").textContent = confirmed;
    document.getElementById("stat-total-count").textContent = fullList.length;
  }).catch(() => {});
}

async function updateAppointmentStatus(appointmentId, newStatus) {
  const actionsText = {
    confirmado: "confirmar este agendamento",
    concluido: "marcar este atendimento como concluído",
    cancelado: "cancelar este agendamento"
  };

  if (!confirm(`Deseja realmente ${actionsText[newStatus] || 'alterar o status'}?`)) {
    return;
  }

  try {
    await apiRequest(`/api/supervisor/appointments/${appointmentId}/status`, "PATCH", { status: newStatus });
    showToast(`Status atualizado com sucesso!`, "success");
    loadSupervisorAppointments();
  } catch (e) {}
}

function clearSupervisorFilters() {
  document.getElementById("supervisor-filter-status").value = "todos";
  document.getElementById("supervisor-filter-date").value = "";
  loadSupervisorAppointments();
}

// Configuração de Horários (Supervisor)
function renderQuickHoursPills() {
  const hoursPool = [
    "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", 
    "11:00", "11:30", "13:00", "13:30", "14:00", "14:30", 
    "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"
  ];

  const extra = Array.from(state.quickHoursSelected).filter(h => !hoursPool.includes(h));
  const html = hoursPool.concat(extra).sort().map(h => {
    const isSelected = state.quickHoursSelected.has(h);
    return `
      <button type="button" 
              class="slot-chip ${isSelected ? 'selected' : ''}" 
              style="padding: 0.35rem 0.65rem; font-size: 0.85rem;"
              onclick="toggleQuickHour('${h}')">
        ${h}
      </button>
    `;
  }).join("");

  ["quick-hours-pills", "cal-modal-hours"].forEach(id => {
    const container = document.getElementById(id);
    if (container) container.innerHTML = html;
  });
  const n = document.getElementById("cal-modal-count");
  if (n) n.textContent = `${state.quickHoursSelected.size} horário(s) selecionado(s)`;
}

function toggleQuickHour(hour) {
  if (state.quickHoursSelected.has(hour)) {
    state.quickHoursSelected.delete(hour);
  } else {
    state.quickHoursSelected.add(hour);
  }
  renderQuickHoursPills();
}

function selectAllQuickHours() {
  const business = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  business.forEach(h => state.quickHoursSelected.add(h));
  renderQuickHoursPills();
}

function addCustomHourSlot() {
  const input = document.getElementById("supervisor-custom-time");
  const val = input.value.trim();
  if (val) {
    state.quickHoursSelected.add(val);
    input.value = "";
    renderQuickHoursPills();
    showToast(`Horário ${val} adicionado à seleção.`, "info");
  }
}

async function submitSupervisorSchedules() {
  const date = document.getElementById("supervisor-add-date").value;
  if (!date) {
    showToast("Por favor, selecione uma data.", "error");
    return;
  }

  const times = Array.from(state.quickHoursSelected);
  if (times.length === 0) {
    showToast("Selecione pelo menos um horário para autorizar.", "error");
    return;
  }

  try {
    const res = await apiRequest("/api/supervisor/schedules", "POST", { date, times });
    showToast(res.message || "Horários autorizados com sucesso!", "success");
    loadSupervisorSchedulesList();
  } catch (e) {}
}

const calState = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: new Set(), dragging: false, dragMode: true };

function calIso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function renderMultiCalendar() {
  const el = document.getElementById("multi-calendar");
  if (!el) return;
  const { year, month } = calState;
  const names = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  document.getElementById("cal-month-label").textContent = `${names[month]} ${year}`;
  const now = new Date();
  const todayIso = calIso(now.getFullYear(), now.getMonth(), now.getDate());
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let html = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((n, i) => `<div class="cal-dow" onclick="toggleCalWeekday(${i})">${n}</div>`).join("");
  for (let i = 0; i < first; i++) html += `<div></div>`;
  for (let d = 1; d <= days; d++) {
    const iso = calIso(year, month, d);
    const past = iso < todayIso;
    const cls = ["cal-day", past ? "past" : "", calState.selected.has(iso) ? "selected" : "", iso === todayIso ? "today" : ""].join(" ");
    html += `<div class="${cls}" data-date="${iso}">${d}</div>`;
  }
  el.innerHTML = html;
  updateCalCount();
}

function updateCalCount() {
  const c = document.getElementById("cal-count");
  if (c) c.textContent = `${calState.selected.size} dia(s) marcado(s)`;
}

function changeCalMonth(delta) {
  const d = new Date(calState.year, calState.month + delta, 1);
  calState.year = d.getFullYear();
  calState.month = d.getMonth();
  renderMultiCalendar();
}

function toggleCalWeekday(dow) {
  const days = new Date(calState.year, calState.month + 1, 0).getDate();
  const now = new Date();
  const todayIso = calIso(now.getFullYear(), now.getMonth(), now.getDate());
  const isos = [];
  for (let d = 1; d <= days; d++) {
    const iso = calIso(calState.year, calState.month, d);
    if (new Date(calState.year, calState.month, d).getDay() === dow && iso >= todayIso) isos.push(iso);
  }
  const allOn = isos.length > 0 && isos.every(i => calState.selected.has(i));
  isos.forEach(i => allOn ? calState.selected.delete(i) : calState.selected.add(i));
  renderMultiCalendar();
}

function selectCalWeek() {
  const t = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i);
    calState.selected.add(calIso(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  calState.year = t.getFullYear();
  calState.month = t.getMonth();
  renderMultiCalendar();
}

function clearCalSelection() {
  calState.selected.clear();
  renderMultiCalendar();
}

function calApplyDay(target) {
  if (!target || !target.classList || !target.classList.contains("cal-day") || target.classList.contains("past")) return;
  const iso = target.dataset.date;
  if (calState.dragMode) calState.selected.add(iso); else calState.selected.delete(iso);
  target.classList.toggle("selected", calState.dragMode);
  updateCalCount();
}

document.addEventListener("mousedown", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("cal-day") && !t.classList.contains("past")) {
    calState.dragging = true;
    calState.dragMode = !calState.selected.has(t.dataset.date);
    calApplyDay(t);
    e.preventDefault();
  }
});
document.addEventListener("mouseover", (e) => { if (calState.dragging) calApplyDay(e.target); });
document.addEventListener("mouseup", () => { calState.dragging = false; });

async function submitCalendarSchedules() {
  const dates = Array.from(calState.selected).sort();
  if (dates.length === 0) {
    showToast("Marque ao menos um dia no calendário.", "error");
    return;
  }
  renderQuickHoursPills();
  document.getElementById("cal-modal-days").textContent = dates.map(formatDateBR).join(", ");
  document.getElementById("modal-cal-hours").classList.add("active");
}

function closeCalHoursModal() {
  document.getElementById("modal-cal-hours").classList.remove("active");
}

function addCalModalCustomHour() {
  const input = document.getElementById("cal-modal-custom-time");
  if (input.value) {
    state.quickHoursSelected.add(input.value);
    input.value = "";
    renderQuickHoursPills();
  }
}

async function confirmCalendarSchedules() {
  const dates = Array.from(calState.selected).sort();
  const times = Array.from(state.quickHoursSelected).sort();
  if (times.length === 0) {
    showToast("Selecione ao menos um horário.", "error");
    return;
  }
  closeCalHoursModal();
  try {
    const res = await apiRequest("/api/supervisor/schedules/dates", "POST", { dates, times });
    showToast(res.message, "success");
    loadSupervisorSchedulesList();
  } catch (e) {}
}
async function loadSupervisorSchedulesList() {
  const container = document.getElementById("supervisor-schedules-grid");
  const statsBadge = document.getElementById("schedule-stats-badge");
  const dateInput = document.getElementById("supervisor-add-date");
  const selectedDate = dateInput ? dateInput.value : "";

  container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--gray-muted);">Carregando horários...</div>`;

  try {
    const url = selectedDate ? `/api/supervisor/schedules?date=${selectedDate}` : `/api/supervisor/schedules`;
    const schedules = await apiRequest(url);

    if (schedules.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 1.5rem; color: var(--gray-muted);">
          Nenhum horário cadastrado para ${selectedDate ? formatDateBR(selectedDate) : 'esta data'}.<br>
          <strong>Nenhum cliente conseguirá agendar neste dia</strong> até que você autorize horários usando o formulário acima.
        </div>
      `;
      if (statsBadge) statsBadge.innerHTML = "";
      return;
    }

    const authorizedFree = schedules.filter(s => s.is_active === 1 && !s.appointment_id).length;
    const blockedCount = schedules.filter(s => s.is_active === 0).length;
    const bookedCount = schedules.filter(s => s.appointment_id).length;

    if (statsBadge) {
      statsBadge.innerHTML = `
        <span class="badge" style="background: #ecfdf5; color: #065f46;">🟢 ${authorizedFree} Autorizados</span>
        <span class="badge" style="background: #fef2f2; color: #991b1b;">⛔ ${blockedCount} Indisponíveis</span>
        <span class="badge" style="background: #fdf4ff; color: #86198f;">🔒 ${bookedCount} Reservados</span>
      `;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; margin-top: 1rem;">
        ${schedules.map(s => {
          if (s.appointment_id) {
            return `
              <div style="background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="color: #991b1b; font-size: 1.1rem;">🔒 ${s.time}</strong><br>
                  <span style="font-size: 0.85rem; color: #7f1d1d;">Cliente: <strong>${escapeHtml(s.client_name)}</strong></span><br>
                  <span style="font-size: 0.75rem; color: #b91c1c; text-transform: uppercase;">Status: ${s.appointment_status}</span>
                </div>
              </div>
            `;
          } else if (s.is_active === 1) {
            return `
              <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="color: #065f46; font-size: 1.1rem;">🟢 ${s.time}</strong><br>
                  <span style="font-size: 0.8rem; color: #047857; font-weight: 600;">Autorizado (Disponível)</span>
                </div>
                <div style="display: flex; gap: 0.35rem;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="toggleScheduleStatus(${s.id})" title="Bloquear e tornar indisponível para clientes">
                    ⛔ Bloquear
                  </button>
                  <button type="button" class="btn btn-outline-primary btn-sm" style="color: #dc2626; border-color: #fca5a5;" onclick="deleteSupervisorSchedule(${s.id})" title="Excluir">
                    🗑️
                  </button>
                </div>
              </div>
            `;
          } else {
            return `
              <div style="background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; opacity: 0.85;">
                <div>
                  <strong style="color: #4b5563; font-size: 1.1rem; text-decoration: line-through;">⛔ ${s.time}</strong><br>
                  <span style="font-size: 0.8rem; color: #6b7280; font-weight: 600;">Indisponível (Bloqueado)</span>
                </div>
                <div style="display: flex; gap: 0.35rem;">
                  <button type="button" class="btn btn-success btn-sm" onclick="toggleScheduleStatus(${s.id})" title="Autorizar e liberar para clientes">
                    ✅ Autorizar
                  </button>
                  <button type="button" class="btn btn-outline-primary btn-sm" style="color: #dc2626; border-color: #fca5a5;" onclick="deleteSupervisorSchedule(${s.id})" title="Excluir">
                    🗑️
                  </button>
                </div>
              </div>
            `;
          }
        }).join("")}
      </div>
    `;

  } catch (e) {
    container.innerHTML = `<div style="text-align: center; color: var(--danger); padding: 1.5rem;">Erro ao listar horários.</div>`;
  }
}

async function toggleScheduleStatus(schedId) {
  try {
    const res = await apiRequest(`/api/supervisor/schedules/${schedId}/toggle`, "PATCH");
    showToast(res.message, "success");
    loadSupervisorSchedulesList();
  } catch (e) {}
}

async function blockAllDaySchedules() {
  const dateInput = document.getElementById("supervisor-add-date");
  const date = dateInput ? dateInput.value : "";
  if (!date) {
    showToast("Selecione uma data para bloquear.", "error");
    return;
  }
  if (!confirm(`Tem certeza que deseja BLOQUEAR e deixar todos os horários de ${formatDateBR(date)} INDISPONÍVEIS para os clientes?`)) {
    return;
  }
  try {
    const res = await apiRequest(`/api/supervisor/schedules/day/block-all`, "POST", { date });
    showToast(res.message, "info");
    loadSupervisorSchedulesList();
  } catch (e) {}
}

async function authorizeAllDaySchedules() {
  const dateInput = document.getElementById("supervisor-add-date");
  const date = dateInput ? dateInput.value : "";
  if (!date) {
    showToast("Selecione uma data para autorizar.", "error");
    return;
  }
  try {
    const res = await apiRequest(`/api/supervisor/schedules/day/authorize-all`, "POST", { date });
    showToast(res.message, "success");
    loadSupervisorSchedulesList();
  } catch (e) {}
}

async function deleteSupervisorSchedule(schedId) {
  if (!confirm("Deseja remover permanentemente este horário?")) return;
  try {
    await apiRequest(`/api/supervisor/schedules/${schedId}`, "DELETE");
    showToast("Horário removido com sucesso.", "info");
    loadSupervisorSchedulesList();
  } catch (e) {}
}

// Utilitários de Interface
function renderStatusBadge(status) {
  switch (status) {
    case "pendente":
      return `<span class="badge badge-pendente">🟡 Pendente</span>`;
    case "confirmado":
      return `<span class="badge badge-confirmado">🟢 Confirmado</span>`;
    case "concluido":
      return `<span class="badge badge-concluido">✔️ Concluído</span>`;
    case "cancelado":
      return `<span class="badge badge-cancelado">❌ Cancelado</span>`;
    default:
      return `<span class="badge">${status}</span>`;
  }
}

function sanitizePhone(phone) {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Minha Conta
function openProfileModal() {
  if (!state.currentUser) return;
  document.getElementById("profile-name").value = state.currentUser.name;
  document.getElementById("profile-phone").value = state.currentUser.phone || "";
  const uEl = document.getElementById("profile-username");
  uEl.value = state.currentUser.username;
  uEl.disabled = state.currentUser.username === "admin";
  document.getElementById("profile-current-password").value = "";
  document.getElementById("profile-new-password").value = "";
  document.getElementById("modal-profile").classList.add("active");
}

function closeProfileModal() {
  document.getElementById("modal-profile").classList.remove("active");
}

async function saveProfileName() {
  const name = document.getElementById("profile-name").value.trim();
  if (name.length < 2) {
    showToast("Informe um nome válido.", "error");
    return;
  }
  try {
    const res = await apiRequest("/api/auth/profile", "PUT", {
      name,
      phone: document.getElementById("profile-phone").value.trim(),
      username: document.getElementById("profile-username").value.trim()
    });
    state.currentUser = res.user;
    if (res.user.username === "admin") await loadContact();
    document.getElementById("user-display-name").textContent = res.user.name.split(" ")[0];
    showToast(res.message, "success");
  } catch (e) {}
}

async function savePassword() {
  const current_password = document.getElementById("profile-current-password").value;
  const new_password = document.getElementById("profile-new-password").value;
  if (!current_password || new_password.length < 4) {
    showToast("Informe a senha atual e uma nova senha de ao menos 4 caracteres.", "error");
    return;
  }
  try {
    const res = await apiRequest("/api/auth/change-password", "POST", { current_password, new_password });
    document.getElementById("profile-current-password").value = "";
    document.getElementById("profile-new-password").value = "";
    showToast(res.message, "success");
  } catch (e) {}
}

async function loadSupervisorClients() {
  const el = document.getElementById("supervisor-clients-list");
  try {
    const clients = await apiRequest("/api/supervisor/clients");
    if (!clients.length) {
      el.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--gray-muted);">Nenhuma cliente cadastrada.</div>`;
      return;
    }
    state.clients = clients;
    el.innerHTML = clients.map(c => `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.85rem 0; border-bottom: 1px solid var(--gray-border);">
        <div><strong>${escapeHtml(c.name)}</strong><br>
          <span style="font-size: 0.85rem; color: var(--gray-muted);">${escapeHtml(c.username)} • ${escapeHtml(c.phone)}</span></div>
        <div class="flex-gap">
        <button class="btn btn-secondary btn-sm" onclick="openClientEditModal(${c.id})">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="resetClientPassword(${c.id}, '${escapeHtml(c.name).replace(/'/g, "&#39;")}')">🔄 Resetar senha</button>
        </div>
      </div>
    `).join("");
  } catch (e) {}
}

async function resetClientPassword(id, name) {
  if (!confirm(`Resetar a senha de ${name} para 1234?`)) return;
  try {
    const res = await apiRequest(`/api/supervisor/clients/${id}/reset-password`, "POST");
    showToast(res.message, "success");
  } catch (e) {}
}
function openClientEditModal(id) {
  const c = (state.clients || []).find(x => x.id === id);
  if (!c) return;
  document.getElementById("client-edit-id").value = c.id;
  document.getElementById("client-edit-name").value = c.name;
  document.getElementById("client-edit-username").value = c.username;
  document.getElementById("client-edit-phone").value = c.phone || "";
  document.getElementById("modal-client-edit").classList.add("active");
}

function closeClientEditModal() {
  document.getElementById("modal-client-edit").classList.remove("active");
}

async function saveClientEdit() {
  const id = document.getElementById("client-edit-id").value;
  const body = {
    name: document.getElementById("client-edit-name").value.trim(),
    username: document.getElementById("client-edit-username").value.trim(),
    phone: document.getElementById("client-edit-phone").value.trim()
  };
  if (body.name.length < 2 || body.username.length < 3) {
    showToast("Informe nome e e-mail/usuário válidos.", "error");
    return;
  }
  try {
    const res = await apiRequest(`/api/supervisor/clients/${id}`, "PUT", body);
    showToast(res.message, "success");
    closeClientEditModal();
    loadSupervisorClients();
  } catch (e) {}
}