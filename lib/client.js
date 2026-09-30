/**
 * dsh-desktop-restart — browser half.
 *
 * Renders one sidebar-footer control into the `sidebar.footer.action` slot.
 * The sidebar foot is a column (`footArea`) whose two children are, in order,
 * the footer-action region and the settings region that holds the account
 * button; so this slot's row is the row whose bottom edge touches the account
 * button's top edge. That is the placement, and it is structural — no absolute
 * positioning and no measuring the account button at runtime.
 *
 * Clicking asks the Host to restart the desktop application. The request is
 * two-step on purpose: restarting closes every running task, exactly like the
 * Windows restart command the placement is modelled on, so one stray click must
 * not be enough. The page then polls until the replacement Host answers.
 *
 * Bundle format: `window.__ModuleLoader__.load({ id, factory })`.
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-restart",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /**
     * Report a failure to the Host's log. This bundle runs inside a page whose
     * console is not reachable from outside, so a slot that never registers
     * would otherwise fail completely silently — the page shows no control and
     * says nothing.
     */
    function reportFailure(stage, error) {
      try {
        fetch("/dsh-desktop-restart/beacon", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stage: stage,
            detail: String(error && error.message ? error.message : error),
          }),
        }).catch(function () {});
      } catch (ignored) {
        /* the report must never be the failure it describes */
      }
    }

    var react = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /**
     * Restart glyph. Drawn on the shell's 16-unit icon grid (viewBox 0 0 16 16)
     * so it matches the neighbouring controls at every rendered size; the
     * original 24-unit path rendered at 16px would sit ~3/4 scale with a
     * hairline stroke.
     */
    function IconRestart(props) {
      var size = props.size;
      return react.createElement("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.3,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      }, [
        react.createElement("path", {
          key: "arc",
          d: "M14 8a6 6 0 1 1-1.76-4.24",
        }),
        react.createElement("polyline", {
          key: "head",
          points: "14 2 14 6 10 6",
        }),
      ]);
    }

    var Tooltip = primitives.Tooltip;

    var ROUTE = "/dsh-desktop-restart";
    var NS = "extra.sidebar-restart";
    var CONFIRM_MS = 4000;
    var POLL_MS = 1000;
    var POLL_LIMIT = 90;

    var DICTIONARIES = {
      zh: {
        idle: "重启应用",
        confirm: "再次点击确认重启",
        confirming: "重启会中断正在运行的任务",
        restarting: "正在重启…",
        failed: "重启请求失败",
        refused: "服务器拒绝了重启请求",
        retry: "重启失败，点击重试",
        timeout: "90 秒内未检测到服务恢复，请重新打开应用",
        unsupported: "当前环境不支持重启",
      },
      en: {
        idle: "Restart app",
        confirm: "Click again to restart",
        confirming: "Restarting interrupts running tasks",
        restarting: "Restarting…",
        failed: "Restart request failed",
        refused: "The Host refused the restart request",
        retry: "Restart failed — click to retry",
        timeout: "The service did not come back within 90 seconds; reopen the app",
        unsupported: "Restart is unavailable here",
      },
    };

    /**
     * Formatting mirrors the account control directly beneath it — the same
     * `.trigger` geometry (100% width, 44px tall, 6px padding, 8px gap,
     * `--dsw-radius-md`, 14px label), the same 24px circular leading badge, and
     * the same theme aliases rather than literal colours, so the two rows read
     * as one stack and both follow light/dark themes.
     */
    var CSS = [
      ".dshdr-root{user-select:none;box-sizing:border-box;width:100%;height:44px;display:flex;align-items:center;gap:8px;padding:6px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer;-webkit-app-region:no-drag}",
      ".dshdr-root:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dshdr-root:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
      ".dshdr-root:disabled{cursor:default;color:var(--dsw-alias-label-secondary)}",
      ".dshdr-root[data-confirming=true]:not(:disabled){color:var(--dsw-alias-state-warning-primary)}",
      // Same badge as the account avatar: 24px circle, skeleton fill, tertiary glyph.
      ".dshdr-icon{flex:none;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--dsw-alias-bg-skeleton);color:var(--dsw-alias-label-tertiary)}",
      ".dshdr-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}",
      ".dshdr-busy .dshdr-icon{animation:dshdr-spin 1s linear infinite;transform-box:fill-box;transform-origin:center}",
      "@keyframes dshdr-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}",
      // Collapsed rail: shrink to the badge so the parent can centre the row.
      ".dshdr-rail{width:auto;padding:6px}",
      "@media (prefers-reduced-motion:reduce){.dshdr-busy .dshdr-icon{animation:none}}",
    ].join("");
    
    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-desktop-restart"]') !== null) return;
      var tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-desktop-restart";
      tag.textContent = CSS;
      document.head.append(tag);
    }

    /** Ask the Host whether this deployment can restart, and why not when it cannot. */
    function probe() {
      return fetch(ROUTE, {
        method: "POST",
        cache: "no-store",
        headers: { "x-dsh-restart-probe": "1" },
      }).then(function (response) {
        return response.json().catch(function () { return {}; });
      }).catch(function () {
        return {};
      });
    }

    function RestartControl(props) {
      var wide = Boolean(props.wide);
      var t = typeof props.t === "function" ? props.t : function (key) { return key; };
      var phaseState = react.useState("idle");
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var reasonState = react.useState("");
      var reason = reasonState[0];
      var setReason = reasonState[1];
      var confirmTimer = react.useRef(0);

      // A deployment that cannot restart says so through the tooltip instead of
      // failing at click time. One probe per page.
      react.useEffect(function () {
        var cancelled = false;
        probe().then(function (result) {
          if (cancelled || result.supported !== false) return;
          setReason(String(result.reason ? result.reason : ""));
        });
        return function () {
          cancelled = true;
          window.clearTimeout(confirmTimer.current);
        };
      }, []);

      function startPolling() {
        var attempts = 0;
        var timer = window.setInterval(function () {
          attempts += 1;
          // The Host dies mid-restart, so recovery is detected by the origin
          // answering again; the shell reloads the application page itself.
          fetch("/", { method: "GET", cache: "no-store" }).then(function (response) {
            if (!response.ok) return;
            window.clearInterval(timer);
            window.location.reload();
          }).catch(function () {
            /* still down */
          });
          if (attempts >= POLL_LIMIT) {
            window.clearInterval(timer);
            setPhase("failed");
          }
        }, POLL_MS);
      }

      function request() {
        setPhase("restarting");
        fetch(ROUTE, { method: "POST", cache: "no-store" }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (response.ok && body.ok === true) {
              startPolling();
              return;
            }
            setPhase("failed");
            setReason(String(body.error ? body.error : t("refused")));
          });
        }).catch(function (error) {
          setPhase("failed");
          setReason(t("failed") + ": " + String(error && error.message ? error.message : error));
        });
      }

      function onClick() {
        if (phase === "restarting" || phase === "unsupported") return;
        if (phase === "confirm") {
          window.clearTimeout(confirmTimer.current);
          request();
          return;
        }
        setPhase("confirm");
        confirmTimer.current = window.setTimeout(function () {
          setPhase("idle");
        }, CONFIRM_MS);
      }

      var unsupported = reason !== "";
      var busy = phase === "restarting";
      var confirming = phase === "confirm";
      var label = unsupported
        ? t("unsupported")
        : busy
          ? t("restarting")
          : phase === "failed"
            ? t("retry")
            : confirming
              ? t("confirm")
              : t("idle");
      var hint = unsupported && reason !== "" ? label + " — " + reason : label;

      var button = react.createElement("button", {
        type: "button",
        className: "dshdr-root" + (busy ? " dshdr-busy" : "") + (wide ? "" : " dshdr-rail"),
        "data-confirming": confirming ? "true" : "false",
        onClick: onClick,
        disabled: busy || unsupported,
        "aria-label": hint,
      }, [
        react.createElement("span", { className: "dshdr-icon", key: "icon" },
          react.createElement(IconRestart, { size: 16 })),
        wide ? react.createElement("span", { className: "dshdr-label", key: "label" }, label) : null,
      ]);

      return react.createElement(Tooltip, {
        label: hint,
        side: wide ? "top" : "right",
        delayMs: 400,
        portal: true,
        maxWidth: 320,
      }, button);
    }

    function apply(ctx) {
      try {
        ensureStyles();
        ctx.effect(function () {
          return ctx.locale.register(NS, DICTIONARIES);
        }, "dsh-desktop-restart: dictionaries");

        ctx.slots.inject("sidebar.footer.action", function () {
          // A list slot keys its rows by `id`; without one the registration is
          // refused and the control silently never renders.
          return ctx.slots.register({
            name: "sidebar.footer.action",
            id: "dsh-desktop-restart",
            order: 10,
            locale: NS,
          }, RestartControl);
        });
      } catch (error) {
        reportFailure("apply", error);
        throw error;
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  },
});
