"use strict";

const STORAGE_KEY = "nudge.reminders.v1";
const DEFAULT_INTERVAL = 180;
const INTERVAL_STEP = 15;
const CHECK_INTERVAL_MS = 5_000;

const elements = {
  create: document.querySelector("#create-button"),
  emptyCreate: document.querySelector("#empty-create-button"),
  install: document.querySelector("#install-button"),
  list: document.querySelector("#reminder-list"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#routine-count"),
  permissionBanner: document.querySelector("#permission-banner"),
  permissionButton: document.querySelector("#permission-button"),
  exactAlarmBanner: document.querySelector("#exact-alarm-banner"),
  exactAlarmButton: document.querySelector("#exact-alarm-button"),
  editor: document.querySelector("#editor-dialog"),
  form: document.querySelector("#editor-form"),
  title: document.querySelector("#reminder-title"),
  note: document.querySelector("#reminder-note"),
  start: document.querySelector("#start-time"),
  end: document.querySelector("#end-time"),
  interval: document.querySelector("#interval-input"),
  intervalValue: document.querySelector("#interval-value"),
  intervalMinus: document.querySelector("#interval-minus"),
  intervalPlus: document.querySelector("#interval-plus"),
  cancel: document.querySelector("#cancel-button"),
  editorTitle: document.querySelector("#editor-title"),
  editorEyebrow: document.querySelector("#dialog-eyebrow"),
  error: document.querySelector("#form-error"),
  arrival: document.querySelector("#arrival-dialog"),
  arrivalTime: document.querySelector("#arrival-time"),
  arrivalTitle: document.querySelector("#arrival-title"),
  arrivalStage: document.querySelector("#arrival-stage"),
  arrivalNote: document.querySelector("#arrival-note"),
  arrivalDone: document.querySelector("#arrival-done"),
  toast: document.querySelector("#toast"),
};

let reminders = [];
let editingId = null;
let selectedAvatar = "girl";
let serviceWorkerRegistration = null;
let deferredInstallPrompt = null;
let lastTick = Date.now();
let toastTimeout = 0;

function createCharacter(avatar) {
  const hair = avatar === "boy"
    ? `<path d="M166 222c-7-84 26-139 87-143 63-4 95 44 97 119l-25-14-13-56-45 37-71 1-22 51z" fill="#382f2b"/>`
    : `<path d="M163 238c-9-91 26-158 96-158 67 0 96 57 91 145l-25-11-12-58-48 27-69 0-11 80z" fill="#593d37"/><path d="M173 214h23v118h-23z" rx="11" fill="#593d37"/><path d="M320 207h20v122h-20z" rx="10" fill="#593d37"/>`;
  const outfit = avatar === "boy" ? "#648aa4" : "#e79a83";
  const name = avatar === "boy" ? "Boy character holding a water bottle" : "Girl character holding a water bottle";
  return `<svg class="character" viewBox="0 0 480 520" role="img" aria-label="${name}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="240" cy="504" rx="170" ry="15" fill="#8da893" opacity=".19"/>
    <path d="M157 215c0-71 38-113 86-113s86 42 86 113v30c0 57-39 100-86 100s-86-43-86-100z" fill="#f3c9a8"/>
    ${hair}
    <circle cx="216" cy="230" r="5.5" fill="#28372f"/><circle cx="273" cy="230" r="5.5" fill="#28372f"/>
    <path d="M222 260q20 16 40 0" fill="none" stroke="#ad655c" stroke-width="6" stroke-linecap="round"/>
    <path d="M177 330h132q48 0 61 55l34 113H116l23-112q9-51 38-56z" fill="${outfit}"/>
    <path d="M185 371 124 424" fill="none" stroke="#f3c9a8" stroke-width="24" stroke-linecap="round"/>
    <g class="bottle-group">
      <path d="m307 361 47 52" fill="none" stroke="#f3c9a8" stroke-width="23" stroke-linecap="round"/>
      <rect x="339" y="395" width="48" height="87" rx="14" fill="#80c6d6"/>
      <rect x="350" y="379" width="27" height="23" rx="7" fill="#4d96aa"/>
      <path d="M351 419v42" stroke="white" stroke-width="7" stroke-linecap="round" opacity=".74"/>
      <path d="M361 438h15" stroke="#4d96aa" stroke-width="4" stroke-linecap="round" opacity=".72"/>
    </g>
    <path d="m204 480-13 20m83-20 17 20" stroke="#f3c9a8" stroke-width="20" stroke-linecap="round"/>
  </svg>`;
}

function isReminder(value) {
  return value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.note === "string" &&
    Number.isInteger(value.startMinute) &&
    value.startMinute >= 0 &&
    value.startMinute < 1440 &&
    Number.isInteger(value.endMinute) &&
    value.endMinute > value.startMinute &&
    value.endMinute < 1440 &&
    Number.isInteger(value.intervalMinutes) &&
    value.intervalMinutes >= INTERVAL_STEP &&
    value.intervalMinutes <= 720 &&
    (value.avatar === "girl" || value.avatar === "boy") &&
    typeof value.enabled === "boolean";
}

function readReminders() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.some((item) => !isReminder(item))) {
      throw new Error("Your saved reminders have an unexpected format.");
    }
    return parsed;
  } catch (error) {
    showToast(`Couldn't load your saved reminders: ${error.message}`);
    return [];
  }
}

function writeReminders(nextReminders) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextReminders));
  } catch (error) {
    showToast(`Couldn't save your reminder: ${error.message}`);
    return false;
  }
  reminders = nextReminders;
  syncNativeReminders();
  return true;
}

function isNativeAndroid() {
  return typeof window.NudgeNative !== "undefined";
}

function syncNativeReminders() {
  if (!isNativeAndroid()) return;
  try {
    const result = window.NudgeNative.syncReminders(JSON.stringify(reminders));
    if (typeof result !== "string" || !result.startsWith("ok:")) {
      showToast(`Reminder saved, but Android couldn't schedule its alarm: ${String(result).replace(/^error:\s*/, "")}`);
    }
  } catch (error) {
    showToast(`Reminder saved, but Android couldn't schedule its alarm: ${error.message}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatTime(minute) {
  const date = new Date();
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatInterval(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

function renderReminders() {
  const enabledCount = reminders.filter((reminder) => reminder.enabled).length;
  elements.count.textContent = `${enabledCount} ACTIVE`;
  elements.empty.hidden = reminders.length !== 0;
  elements.list.hidden = reminders.length === 0;

  elements.list.innerHTML = reminders.map((reminder) => {
    const waterRelated = isWaterRelated(reminder);
    const description = `${escapeHtml(reminder.note)} · ${formatTime(reminder.startMinute)}–${formatTime(reminder.endMinute)}`;
    const character = reminder.avatar === "girl" ? "Girl" : "Boy";
    return `<article class="reminder-card${reminder.enabled ? "" : " disabled"}" data-id="${escapeHtml(reminder.id)}">
      <span class="reminder-icon" aria-hidden="true">${waterRelated ? "💧" : "✳"}</span>
      <div class="reminder-details">
        <h3 class="reminder-name">${escapeHtml(reminder.title)}</h3>
        <p class="reminder-description">${description}</p>
        <p class="reminder-meta">${character} character · every ${formatInterval(reminder.intervalMinutes)}</p>
      </div>
      <div class="card-actions">
        <button class="icon-button edit" type="button" aria-label="Edit ${escapeHtml(reminder.title)}" data-action="edit">✎</button>
        <button class="icon-button delete" type="button" aria-label="Delete ${escapeHtml(reminder.title)}" data-action="delete">×</button>
      </div>
      <label class="toggle-control" aria-label="${reminder.enabled ? "Disable" : "Enable"} ${escapeHtml(reminder.title)}">
        <input type="checkbox" data-action="toggle" ${reminder.enabled ? "checked" : ""} aria-label="${reminder.enabled ? "Disable" : "Enable"} ${escapeHtml(reminder.title)}">
        <span class="toggle-track"></span>
      </label>
    </article>`;
  }).join("");

  refreshPermissionBanner();
}

function refreshPermissionBanner() {
  if (isNativeAndroid()) {
    const permitted = window.NudgeNative.hasNotificationPermission();
    elements.permissionBanner.hidden = permitted;
    elements.permissionButton.hidden = permitted;
    elements.permissionBanner.querySelector(".permission-copy strong").textContent =
      "Let us give you a little nudge";
    elements.permissionBanner.querySelector(".permission-copy > span").textContent =
      "Allow notifications so your character can bring your reminders to you.";
    refreshExactAlarmBanner();
    return;
  }
  elements.exactAlarmBanner.hidden = true;
  if (!("Notification" in window)) {
    elements.permissionBanner.hidden = false;
    elements.permissionBanner.querySelector(".permission-copy strong").textContent = "Notifications aren't available here";
    elements.permissionBanner.querySelector(".permission-copy > span").textContent =
      "Open Nudge in a browser that supports notifications. Reminders still appear while the app is open.";
    elements.permissionButton.hidden = true;
    return;
  }
  if (Notification.permission === "denied") {
    elements.permissionBanner.hidden = false;
    elements.permissionBanner.querySelector(".permission-copy strong").textContent =
      "Browser notifications are turned off";
    elements.permissionBanner.querySelector(".permission-copy > span").textContent =
      "Enable notifications for this site in your browser settings. Nudges still appear while Nudge is open.";
    elements.permissionButton.hidden = true;
    return;
  }
  elements.permissionBanner.hidden = Notification.permission === "granted";
  elements.permissionBanner.querySelector(".permission-copy strong").textContent =
    "Let us give you a little nudge";
  elements.permissionBanner.querySelector(".permission-copy > span").textContent =
    "Turn on browser notifications to see reminders while Nudge is open.";
  elements.permissionButton.hidden = Notification.permission !== "default";
}

function refreshExactAlarmBanner() {
  if (!isNativeAndroid()) {
    elements.exactAlarmBanner.hidden = true;
    return;
  }
  const permitted = window.NudgeNative.canScheduleExactAlarms();
  elements.exactAlarmBanner.hidden = permitted;
  elements.exactAlarmButton.hidden = permitted;
}

function setIntervalValue(value) {
  const interval = Math.min(720, Math.max(INTERVAL_STEP, Math.round(value / INTERVAL_STEP) * INTERVAL_STEP));
  elements.interval.value = String(interval);
  elements.intervalValue.textContent = formatInterval(interval);
  elements.intervalMinus.disabled = interval <= INTERVAL_STEP;
  elements.intervalPlus.disabled = interval >= 720;
}

function selectAvatar(avatar) {
  selectedAvatar = avatar;
  document.querySelectorAll(".character-option").forEach((option) => {
    const selected = option.dataset.avatar === avatar;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-checked", String(selected));
  });
}

function openEditor(reminder = null) {
  editingId = reminder?.id ?? null;
  elements.form.reset();
  elements.error.hidden = true;
  elements.editorTitle.innerHTML = editingId === null
    ? "What should we<br>nudge you about?"
    : "A little change<br>of plans?";
  elements.editorEyebrow.textContent = editingId === null ? "A NEW ROUTINE" : "UPDATE YOUR ROUTINE";
  elements.title.value = reminder?.title ?? "";
  elements.note.value = reminder?.note ?? "Take a sip and stay hydrated.";
  elements.start.value = minuteToTime(reminder?.startMinute ?? 9 * 60);
  elements.end.value = minuteToTime(reminder?.endMinute ?? 16 * 60);
  setIntervalValue(reminder?.intervalMinutes ?? DEFAULT_INTERVAL);
  selectAvatar(reminder?.avatar ?? "girl");
  elements.editor.showModal();
  requestAnimationFrame(() => elements.title.focus());
}

function minuteToTime(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function timeToMinute(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove("visible"), 3800);
}

function isWaterRelated(reminder) {
  return /water|drink|hydr|sip/i.test(`${reminder.title} ${reminder.note}`);
}

function showArrival(reminder, dueAt = new Date()) {
  if (elements.arrival.open) return;
  elements.arrivalTime.dateTime = dueAt.toISOString();
  elements.arrivalTime.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(dueAt);
  elements.arrivalTitle.textContent = reminder.title;
  elements.arrivalStage.innerHTML = createCharacter(reminder.avatar);
  elements.arrivalStage.classList.toggle("drink", isWaterRelated(reminder));
  elements.arrivalNote.textContent = reminder.note;
  elements.arrival.showModal();
}

async function sendNotification(reminder, dueAt) {
  if (isNativeAndroid()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const data = {
    title: reminder.title,
    body: reminder.note,
    icon: new URL("./icon.svg", location.href).href,
    tag: `nudge-${reminder.id}`,
    data: { reminderId: reminder.id, url: location.href },
  };
  try {
    if (serviceWorkerRegistration) {
      await serviceWorkerRegistration.showNotification(data.title, data);
    } else {
      const notification = new Notification(data.title, {
        body: data.body,
        icon: data.icon,
        tag: data.tag,
      });
      notification.onclick = () => {
        window.focus();
        showArrival(reminder, dueAt);
        notification.close();
      };
    }
  } catch (error) {
    showToast(`The reminder is due, but the browser couldn't show its notification: ${error.message}`);
  }
}

function createOccurrence(reminder, date) {
  const occurrence = new Date(date);
  occurrence.setHours(
    Math.floor(reminder.startMinute / 60),
    reminder.startMinute % 60,
    0,
    0,
  );
  return occurrence;
}

function occurrencesBetween(reminder, from, through) {
  const dueTimes = [];
  const lookback = new Date(through.getTime() - 2 * 24 * 60 * 60 * 1000);
  const startDay = new Date(Math.max(from.getTime(), lookback.getTime()));
  startDay.setHours(0, 0, 0, 0);
  startDay.setDate(startDay.getDate() - 1);
  const lastDay = new Date(through);
  lastDay.setHours(0, 0, 0, 0);
  lastDay.setDate(lastDay.getDate() + 1);

  for (let day = new Date(startDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
    for (
      let minute = reminder.startMinute;
      minute <= reminder.endMinute;
      minute += reminder.intervalMinutes
    ) {
      const occurrence = createOccurrence(reminder, day);
      occurrence.setMinutes(occurrence.getMinutes() + (minute - reminder.startMinute));
      if (occurrence > from && occurrence <= through) dueTimes.push(occurrence);
    }
  }
  return dueTimes;
}

async function checkReminders() {
  const now = new Date();
  const previousCheck = new Date(lastTick);
  lastTick = now.getTime();
  const due = [];
  const firedAt = new Map();

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    const matches = occurrencesBetween(reminder, previousCheck, now);
    if (matches.length === 0) continue;
    const occurrence = matches[matches.length - 1];
    if (reminder.lastFiredAt === occurrence.toISOString()) continue;
    firedAt.set(reminder.id, occurrence.toISOString());
    due.push({ reminder, occurrence });
  }

  if (firedAt.size > 0) {
    const updated = reminders.map((reminder) => firedAt.has(reminder.id)
      ? { ...reminder, lastFiredAt: firedAt.get(reminder.id) }
      : reminder);
    if (!writeReminders(updated)) return;
    renderReminders();
    for (const { reminder, occurrence } of due) {
      await sendNotification(reminder, occurrence);
      if (document.visibilityState === "visible") showArrival(reminder, occurrence);
    }
  }
}

async function enableNotifications() {
  if (isNativeAndroid()) {
    window.NudgeNative.requestNotificationPermission();
    return;
  }
  if (!("Notification" in window)) {
    showToast("This browser doesn't support notifications. Your in-app reminders still work while Nudge is open.");
    return;
  }
  try {
    const result = await Notification.requestPermission();
    refreshPermissionBanner();
    if (result === "granted") {
      showToast("Notifications are on. Your next nudge is all set.");
      await checkReminders();
    } else if (result === "denied") {
      showToast("Notifications are blocked in browser settings. You can still see nudges while Nudge is open.");
    }
  } catch (error) {
    showToast(`Couldn't enable notifications: ${error.message}`);
  }
}

function handleReminderAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = button.closest(".reminder-card");
  if (!card) return;
  const reminder = reminders.find((item) => item.id === card.dataset.id);
  if (!reminder) return;
  const action = button.dataset.action;

  if (action === "edit") {
    openEditor(reminder);
    return;
  }

  if (action === "delete") {
    const title = reminder.title;
    if (!writeReminders(reminders.filter((item) => item.id !== reminder.id))) return;
    renderReminders();
    showToast(`“${title}” has been removed.`);
    return;
  }

  if (action === "toggle") {
    const updated = reminders.map((item) => item.id === reminder.id
      ? { ...item, enabled: button.checked }
      : item);
    if (!writeReminders(updated)) {
      button.checked = reminder.enabled;
      return;
    }
    renderReminders();
  }
}

function handleSubmit(event) {
  event.preventDefault();
  const title = elements.title.value.trim();
  const note = elements.note.value.trim();
  const startMinute = timeToMinute(elements.start.value);
  const endMinute = timeToMinute(elements.end.value);
  const intervalMinutes = Number(elements.interval.value);

  let error = "";
  if (!title) error = "Add a name for your reminder.";
  else if (!note) error = "Add a little message for your character.";
  else if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || endMinute <= startMinute) {
    error = "Pick a finish time that's later than the start time.";
  } else if (!Number.isInteger(intervalMinutes) || intervalMinutes < INTERVAL_STEP || intervalMinutes > 720) {
    error = "Choose an interval between 15 minutes and 12 hours.";
  }

  if (error) {
    elements.error.textContent = error;
    elements.error.hidden = false;
    return;
  }

  const previous = reminders.find((item) => item.id === editingId);
  const reminder = {
    id: editingId ?? crypto.randomUUID(),
    title,
    note,
    startMinute,
    endMinute,
    intervalMinutes,
    avatar: selectedAvatar,
    enabled: previous?.enabled ?? true,
  };
  if (previous?.lastFiredAt) reminder.lastFiredAt = previous.lastFiredAt;

  const next = previous
    ? reminders.map((item) => item.id === previous.id ? reminder : item)
    : [...reminders, reminder];
  if (!writeReminders(next)) return;

  renderReminders();
  elements.editor.close();
  const upcoming = nextOccurrence(reminder, new Date());
  showToast(upcoming
    ? `“${title}” is ready. Your next nudge is ${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(upcoming)}.`
    : `“${title}” is ready for your next daily routine.`);
  checkReminders();
}

function nextOccurrence(reminder, after) {
  if (!reminder.enabled) return null;
  const firstDay = new Date(after);
  firstDay.setHours(0, 0, 0, 0);
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const date = new Date(firstDay);
    date.setDate(date.getDate() + dayOffset);
    for (
      let minute = reminder.startMinute;
      minute <= reminder.endMinute;
      minute += reminder.intervalMinutes
    ) {
      const candidate = createOccurrence(reminder, date);
      candidate.setMinutes(candidate.getMinutes() + (minute - reminder.startMinute));
      if (candidate > after) return candidate;
    }
  }
  return null;
}

function handleNotificationNavigation() {
  const reminderId = new URLSearchParams(location.search).get("reminder");
  if (!reminderId) return;
  const reminder = reminders.find((item) => item.id === reminderId);
  if (!reminder) {
    showToast("That reminder was deleted or is no longer available.");
    history.replaceState(null, "", location.pathname);
    return;
  }
  showArrival(reminder);
  history.replaceState(null, "", location.pathname);
}

function openNudgeReminder(reminderId) {
  const reminder = reminders.find((item) => item.id === reminderId);
  if (!reminder) {
    showToast("That reminder was deleted or is no longer available.");
    return;
  }
  showArrival(reminder);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    showToast(`Offline app setup couldn't finish: ${error.message}`);
  }
}

function handleInstallPrompt() {
  if (!deferredInstallPrompt) {
    showToast("In Chrome or Edge, open the browser menu and choose “Install app” or “Add to Home screen”.");
    return;
  }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((choice) => {
    if (choice.outcome === "accepted") showToast("Nudge is being added to your apps.");
    deferredInstallPrompt = null;
    elements.install.hidden = true;
  }).catch((error) => {
    showToast(`Couldn't install Nudge: ${error.message}`);
  });
}

function initialize() {
  reminders = readReminders();
  renderReminders();
  syncNativeReminders();

  const heroPerson = document.querySelector("#hero-person");
  heroPerson.innerHTML = createCharacter("girl");
  document.querySelectorAll("[data-picker]").forEach((portrait) => {
    portrait.innerHTML = createCharacter(portrait.dataset.picker);
  });

  elements.create.addEventListener("click", () => openEditor());
  elements.emptyCreate.addEventListener("click", () => openEditor());
  elements.list.addEventListener("click", handleReminderAction);
  elements.list.addEventListener("change", (event) => {
    if (event.target.matches('[data-action="toggle"]')) handleReminderAction(event);
  });
  elements.form.addEventListener("submit", handleSubmit);
  elements.cancel.addEventListener("click", () => elements.editor.close());
  elements.permissionButton.addEventListener("click", enableNotifications);
  elements.exactAlarmButton.addEventListener("click", () => {
    if (isNativeAndroid()) window.NudgeNative.requestExactAlarmPermission();
  });
  elements.intervalMinus.addEventListener("click", () => setIntervalValue(Number(elements.interval.value) - INTERVAL_STEP));
  elements.intervalPlus.addEventListener("click", () => setIntervalValue(Number(elements.interval.value) + INTERVAL_STEP));
  elements.arrivalDone.addEventListener("click", () => elements.arrival.close());
  elements.editor.addEventListener("click", (event) => {
    if (event.target === elements.editor) elements.editor.close();
  });
  elements.arrival.addEventListener("click", (event) => {
    if (event.target === elements.arrival) elements.arrival.close();
  });
  document.querySelectorAll(".character-option").forEach((option) => {
    option.addEventListener("click", () => selectAvatar(option.dataset.avatar));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkReminders();
    refreshPermissionBanner();
  });
  window.addEventListener("pageshow", () => {
    refreshPermissionBanner();
    checkReminders();
  });
  window.addEventListener("focus", checkReminders);
  window.setInterval(checkReminders, CHECK_INTERVAL_MS);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.install.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.install.hidden = true;
    showToast("Nudge was added to your home screen. Hello there!");
  });
  elements.install.addEventListener("click", handleInstallPrompt);

  registerServiceWorker();
  handleNotificationNavigation();
  window.openNudgeReminder = openNudgeReminder;
  window.onNativeNotificationPermissionChanged = () => {
    refreshPermissionBanner();
    checkReminders();
  };
}

initialize();
