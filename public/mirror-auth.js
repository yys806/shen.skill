(function () {
  const storageKey = "mirror.auth.session";
  const listeners = new Set();

  function createClient() {
    return {
      auth: {
        getSession,
        onAuthStateChange,
        signInWithPassword,
        signUp,
        signOut,
        verifyOtp,
        resend,
        resetPasswordForEmail,
        updateUser
      },
      from
    };
  }

  async function getSession() {
    const session = readSession();
    if (!session?.access_token) return { data: { session: null }, error: null };
    const response = await api("/api/auth/session", { token: session.access_token });
    if (!response.ok) {
      clearSession();
      return { data: { session: null }, error: null };
    }
    const next = response.data.session || { ...session, user: response.data.user };
    writeSession(next);
    return { data: { session: next }, error: null };
  }

  function onAuthStateChange(callback) {
    listeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe() {
            listeners.delete(callback);
          }
        }
      }
    };
  }

  async function signInWithPassword({ email, password }) {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: { email, password }
    });
    if (!response.ok) return { data: {}, error: toError(response) };
    writeSession(response.data.session);
    emit("SIGNED_IN", response.data.session);
    return { data: response.data, error: null };
  }

  async function signUp({ email, password, options = {} }) {
    const response = await api("/api/auth/signup", {
      method: "POST",
      body: {
        email,
        password,
        nickname: options.data?.nickname || options.nickname || "",
        inviteCode: options.inviteCode || options.data?.inviteCode || ""
      }
    });
    if (!response.ok) return { data: {}, error: toError(response) };
    writeSession(response.data.session);
    emit("SIGNED_IN", response.data.session);
    return { data: response.data, error: null };
  }

  async function signOut() {
    clearSession();
    emit("SIGNED_OUT", null);
    return { error: null };
  }

  async function verifyOtp() {
    return getSession();
  }

  async function resend() {
    return { error: null };
  }

  async function resetPasswordForEmail() {
    return { error: new Error("自托管模式暂未开启邮件重置，请登录后在账户里修改密码。") };
  }

  async function updateUser(payload = {}) {
    const session = readSession();
    if (!session?.access_token) return { data: {}, error: new Error("请先登录。") };
    if (payload.password) {
      const response = await api("/api/auth/password", {
        method: "POST",
        token: session.access_token,
        body: { password: payload.password, oldPassword: payload.oldPassword || "" }
      });
      if (!response.ok) return { data: {}, error: toError(response) };
    }
    if (payload.data?.nickname) {
      const response = await api("/api/auth/profile", {
        method: "POST",
        token: session.access_token,
        body: { nickname: payload.data.nickname }
      });
      if (!response.ok) return { data: {}, error: toError(response) };
      writeSession(response.data.session);
      emit("USER_UPDATED", response.data.session);
      return { data: response.data, error: null };
    }
    return getSession();
  }

  function from(table) {
    if (table === "profiles") return profileQuery();
    if (table === "mirror_conversations") return conversationQuery();
    return emptyQuery();
  }

  function profileQuery() {
    const state = { filters: {}, orValue: "" };
    return {
      upsert: async (profile) => {
        const session = readSession();
        const response = await api("/api/auth/profile", {
          method: "POST",
          token: session?.access_token,
          body: { nickname: profile.nickname }
        });
        return response.ok ? { data: response.data, error: null } : { data: null, error: toError(response) };
      },
      update: (values) => ({
        eq: async () => {
          const session = readSession();
          const response = await api("/api/auth/profile", {
            method: "POST",
            token: session?.access_token,
            body: { nickname: values.nickname }
          });
          return response.ok ? { data: response.data, error: null } : { data: null, error: toError(response) };
        }
      }),
      select() {
        return {
          eq(key, value) {
            state.filters[key] = value;
            return this;
          },
          or(value) {
            state.orValue = value;
            return this;
          },
          async maybeSingle() {
            const identifier = state.filters.nickname_key || state.filters.email || "";
            const response = await api(`/api/auth/resolve?identifier=${encodeURIComponent(identifier)}`);
            if (!response.ok) return { data: null, error: toError(response) };
            return { data: response.data.email ? { email: response.data.email } : null, error: null };
          },
          then(resolve) {
            resolve(checkProfileDuplicate(state.orValue));
          }
        };
      }
    };
  }

  async function checkProfileDuplicate(orValue) {
    const nickname = /nickname_key\.eq\.([^,]+)/.exec(orValue || "")?.[1] || "";
    const email = /email\.eq\.([^,]+)/.exec(orValue || "")?.[1] || "";
    const response = await api(`/api/auth/check-duplicate?nickname=${encodeURIComponent(nickname)}&email=${encodeURIComponent(email)}`);
    if (!response.ok) return { data: [], error: toError(response) };
    const data = [];
    if (response.data.nicknameExists) data.push({ nickname_key: nickname });
    if (response.data.emailExists) data.push({ email });
    return { data, error: null };
  }

  function conversationQuery() {
    const state = {};
    return {
      select() {
        return {
          order: async () => {
            const session = readSession();
            const response = await api("/api/conversations", { token: session?.access_token });
            if (!response.ok) return { data: [], error: toError(response) };
            const rows = (response.data.conversations || []).map(item => ({
              id: item.id,
              title: item.title,
              pinned: item.pinned,
              settings: item.settings,
              messages: item.messages,
              created_at_ms: item.created_at_ms,
              updated_at_ms: item.updated_at_ms
            }));
            return { data: rows, error: null };
          }
        };
      },
      async upsert(rows) {
        const session = readSession();
        const response = await api("/api/conversations", {
          method: "POST",
          token: session?.access_token,
          body: { conversations: rows }
        });
        return response.ok ? { data: response.data, error: null } : { data: null, error: toError(response) };
      },
      delete() {
        return {
          eq: async (_key, id) => {
            const session = readSession();
            const response = await api(`/api/conversations?id=${encodeURIComponent(id)}`, {
              method: "DELETE",
              token: session?.access_token
            });
            return response.ok ? { data: response.data, error: null } : { data: null, error: toError(response) };
          }
        };
      }
    };
  }

  function emptyQuery() {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ data: null, error: null }),
      update: () => ({ eq: async () => ({ data: null, error: null }) })
    };
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function toError(response) {
    const error = new Error(response.data?.detail || response.data?.error || "请求失败。");
    error.status = response.status;
    return error;
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(storageKey);
  }

  function emit(event, session) {
    for (const listener of listeners) listener(event, session);
  }

  window.mirrorAuth = { createClient, getSession, readSession };
  window.supabase = { createClient };
})();
