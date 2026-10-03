// dsh-regen — browser half.
//
// One arrow-only "重新生成" icon, rendered twice with a mutual-exclusion rule:
//   * in the official icon row (conversation.chat.assistant-actions) for turns
//     that produced an assistant reply — it sits between copy and branch;
//   * at the turn tail (conversation.chat.turnTail) for turns WITHOUT one
//     (failed / interrupted generation), where the icon row is never rendered.
// The tail copy hides itself as soon as the row copy exists in the same turn
// container, so a turn never shows the button twice.
window.__ModuleLoader__.load({
  id: "dsh-regen",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const GLYPH = "↻";
    const CSS = [
      ".dsh-regen-icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;margin:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5f574a);font:inherit;font-size:15px;line-height:1;cursor:pointer;transition:background 80ms,color 80ms}",
      ".dsh-regen-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#2b2620)}",
      ".dsh-regen-icon[disabled]{cursor:default;opacity:.55}",
      ".dsh-regen-icon[data-dsh-regen=failed]{color:#c0392b}",
      ".dsh-regen-icon[data-dsh-regen=done]{color:#2e7d32}",
      ".dsh-regen-tail{display:flex;align-items:center;justify-content:flex-start;height:calc(28px + var(--dsh-content-font-delta,0px));gap:8px;margin-left:-6px;order:2}",
      "[data-turn-tail]:has([data-dsh-regen-row]) .dsh-regen-tail{display:none !important}"
    ].join("");

    function useRegen(props) {
      const { sessionId, turn, messageId, openSession } = props;
      const [state, setState] = React.useState("idle");
      const onClick = React.useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state === "busy" || sessionId === undefined) return;
        setState("busy");
        void (async () => {
          try {
            const body = { sessionId };
            if (turn !== undefined) body.turn = turn;
            else if (messageId !== undefined) body.messageId = messageId;
            const response = await fetch("/regen", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              credentials: "same-origin"
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload && payload.error ? payload.error : "HTTP " + String(response.status));
            setState("done");
            if (payload && typeof payload.sessionId === "string" && typeof openSession === "function") openSession(payload.sessionId);
            else setTimeout(() => { setState("idle"); }, 1500);
          } catch (error) {
            console.error("[dsh-regen]", error);
            setState("failed");
            setTimeout(() => { setState("idle"); }, 4000);
          }
        })();
      }, [state, sessionId, turn, messageId, openSession]);
      return { state, onClick };
    }

    function RegenIcon(props) {
      const { state, onClick } = useRegen(props);
      const title = state === "busy" ? "正在重新生成…"
        : state === "done" ? "已重新生成，正在打开新会话"
        : state === "failed" ? "重新生成失败，稍后可再试"
        : props.hadReply === false ? "重新生成这一轮（该回合生成失败，可重试）" : "重新生成这一轮";
      return h("button", {
        type: "button",
        className: "dsh-regen-icon",
        title,
        "aria-label": "重新生成",
        disabled: state === "busy",
        onClick,
        "data-dsh-regen": state,
        ...(props.marker ? { "data-dsh-regen-row": "1" } : {})
      }, GLYPH);
    }

    /** Row copy: lives in the official copy / branch icon row. */
    function RegenRowAction(props) {
      return h(RegenIcon, { ...props, marker: true });
    }

    /** Tail copy: only meaningfully visible where that row does not exist. */
    function RegenTailAction(props) {
      return h("div", { className: "dsh-regen-tail" }, h(RegenIcon, { ...props, hadReply: false }));
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement("style");
          tag.dataset.plugin = "dsh-regen";
          tag.dataset.pluginCss = "dsh-regen/theme.css";
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => { tag.remove(); };
        }, "dsh-regen: styles");
        const perSession = (sessionId) => ({
          sessionId,
          openSession: (id) => { try { ctx.get("uiWorkspace")?.openSession?.(id); } catch (error) { console.error("[dsh-regen] open", error); } }
        });
        ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
          name: "conversation.chat.assistant-actions",
          id: "dsh-regen",
          order: 15,
          inject: perSession
        }, RegenRowAction));
        ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
          name: "conversation.chat.turnTail",
          id: "dsh-regen-tail",
          order: 5,
          inject: perSession
        }, RegenTailAction));
      }
    };
  }
});
