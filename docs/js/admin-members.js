import {
  deleteMember,
  listMembers,
  setMemberRole,
  setMemberStatus,
  upgradeMemberToAdmin,
} from "./auth-service.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function roleLabel(role) {
  return role === "admin" ? "مسؤول" : "عضو";
}

function statusLabel(status) {
  if (status === "suspended") return "معلّق";
  return "نشط";
}

export function initAdminMembers({ getActor, onStatus, isAdmin }) {
  const dialog = document.getElementById("members-dialog");
  const backdrop = document.getElementById("members-dialog-backdrop");
  const closeBtn = document.getElementById("members-close-btn");
  const openBtn = document.getElementById("open-members-btn");
  const listEl = document.getElementById("members-list");
  const searchInput = document.getElementById("members-search");
  const countEl = document.getElementById("members-count");

  let members = [];
  let query = "";

  function filteredMembers() {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) => {
      const haystack = [
        member.username,
        member.firstName,
        member.lastName,
        member.email,
        member.role,
        member.status,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  function isProtected(member, actor) {
    return (
      member.id === "admin-default" ||
      member.username === "admin" ||
      member.id === actor?.id
    );
  }

  function renderMembers() {
    if (!listEl) return;
    const actor = getActor();
    const visible = filteredMembers();

    if (countEl) {
      countEl.textContent = `${visible.length} عضو`;
    }

    if (!visible.length) {
      listEl.innerHTML = `<p class="muted">لا يوجد أعضاء مطابقون للبحث.</p>`;
      return;
    }

    listEl.innerHTML = visible
      .map((member) => {
        const protectedMember = isProtected(member, actor);
        const suspended = member.status === "suspended";
        return `
        <article class="member-row" data-id="${escapeHtml(member.id)}">
          <div class="member-main">
            <div class="member-title">
              <strong>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</strong>
              <span class="member-chip ${member.role === "admin" ? "role-admin" : "role-member"}">${roleLabel(member.role)}</span>
              <span class="member-chip ${suspended ? "status-suspended" : "status-active"}">${statusLabel(member.status)}</span>
            </div>
            <div class="muted member-meta">
              @${escapeHtml(member.username)} · ${escapeHtml(member.email)}
            </div>
            <div class="muted member-meta">
              انضم: ${formatDate(member.createdAt)}${member.approvedAt ? ` · فُعّل: ${formatDate(member.approvedAt)}` : ""}
            </div>
          </div>
          <div class="member-actions">
            ${
              protectedMember
                ? `<span class="muted member-protected">محمي</span>`
                : `
            ${
              member.role === "member"
                ? `<button class="btn primary small member-action-btn" data-action="promote-admin" data-id="${escapeHtml(member.id)}" type="button">ترقية إلى مسؤول</button>`
                : `<button class="btn ghost small member-action-btn" data-action="toggle-role" data-id="${escapeHtml(member.id)}" type="button">إزالة صلاحية المسؤول</button>`
            }
            <button class="btn ghost small member-action-btn" data-action="toggle-status" data-id="${escapeHtml(member.id)}" type="button">
              ${suspended ? "تفعيل" : "تعليق"}
            </button>
            <button class="btn danger small member-action-btn" data-action="delete" data-id="${escapeHtml(member.id)}" type="button">حذف</button>`
            }
          </div>
        </article>`;
      })
      .join("");

    listEl.querySelectorAll(".member-action-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function loadMembers() {
    if (!listEl) return;
    listEl.innerHTML = `<p class="muted">جارٍ تحميل الأعضاء…</p>`;
    try {
      members = await listMembers(getActor());
      renderMembers();
    } catch (error) {
      listEl.innerHTML = `<p class="auth-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function handleAction(action, memberId) {
    const actor = getActor();
    const member = members.find((item) => item.id === memberId);
    if (!member) return;

    try {
      if (action === "toggle-status") {
        const nextStatus = member.status === "suspended" ? "approved" : "suspended";
        const label = nextStatus === "suspended" ? "تعليق" : "تفعيل";
        if (!window.confirm(`${label} حساب @${member.username}؟`)) return;
        await setMemberStatus(memberId, nextStatus, actor);
        onStatus?.(
          nextStatus === "suspended"
            ? `تم تعليق حساب @${member.username}.`
            : `تم تفعيل حساب @${member.username}.`,
          true
        );
      } else if (action === "promote-admin") {
        if (member.role === "admin") return;
        if (
          !window.confirm(
            `ترقية @${member.username} إلى مسؤول؟\nسيحصل على صلاحيات إدارة الأعضاء وطلبات التسجيل. يجب أن يعيد تسجيل الدخول لتفعيل الصلاحيات الجديدة.`
          )
        ) {
          return;
        }
        await upgradeMemberToAdmin(memberId, actor);
        onStatus?.(`تمت ترقية @${member.username} إلى مسؤول.`, true);
      } else if (action === "toggle-role") {
        const nextRole = member.role === "admin" ? "member" : "admin";
        const label = nextRole === "admin" ? "ترقيته إلى مسؤول" : "إزالة صلاحية المسؤول منه";
        if (!window.confirm(`هل تريد ${label} @${member.username}؟`)) return;
        await setMemberRole(memberId, nextRole, actor);
        onStatus?.(
          nextRole === "admin"
            ? `تمت ترقية @${member.username} إلى مسؤول.`
            : `تمت إزالة صلاحية المسؤول من @${member.username}.`,
          true
        );
      } else if (action === "delete") {
        if (
          !window.confirm(
            `حذف @${member.username} نهائياً؟ لن يتمكن من تسجيل الدخول مرة أخرى.`
          )
        ) {
          return;
        }
        await deleteMember(memberId, actor);
        onStatus?.(`تم حذف @${member.username}.`, true);
      }
      await loadMembers();
    } catch (error) {
      onStatus?.(error.message, true);
    }
  }

  function openDialog() {
    if (!isAdmin?.()) return;
    dialog?.classList.remove("hidden");
    loadMembers();
  }

  function closeDialog() {
    dialog?.classList.add("hidden");
  }

  openBtn?.addEventListener("click", openDialog);
  closeBtn?.addEventListener("click", closeDialog);
  backdrop?.addEventListener("click", closeDialog);
  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    renderMembers();
  });

  return { openDialog, closeDialog, refresh: loadMembers };
}
