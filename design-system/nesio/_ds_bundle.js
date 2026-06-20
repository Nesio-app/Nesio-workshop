/* @ds-bundle: {"format":3,"namespace":"NosioDesignSystem_d76dec","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"FloatingButton","sourcePath":"components/core/FloatingButton.jsx"},{"name":"GlassCard","sourcePath":"components/core/GlassCard.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"StatusBadge","sourcePath":"components/core/StatusBadge.jsx"},{"name":"QuoteCard","sourcePath":"components/portal/QuoteCard.jsx"},{"name":"ReminderCard","sourcePath":"components/portal/ReminderCard.jsx"},{"name":"ToolModuleCard","sourcePath":"components/portal/ToolModuleCard.jsx"},{"name":"WeatherTime","sourcePath":"components/portal/WeatherTime.jsx"},{"name":"LOCALES","sourcePath":"lib/i18n.js"},{"name":"LOCALE_LABELS","sourcePath":"lib/i18n.js"},{"name":"STRINGS","sourcePath":"lib/i18n.js"}],"sourceHashes":{"components/core/Button.jsx":"912e5f280f5c","components/core/FloatingButton.jsx":"e7d874e9b328","components/core/GlassCard.jsx":"5a973c63f306","components/core/Input.jsx":"b9bfd76ff2d7","components/core/StatusBadge.jsx":"d84ed828304e","components/portal/QuoteCard.jsx":"220a6d07c01e","components/portal/ReminderCard.jsx":"c4eb41bff35b","components/portal/ToolModuleCard.jsx":"f67d5eb1d3bf","components/portal/WeatherTime.jsx":"4f091c4c7bf4","lib/i18n.js":"17972f5f1021","ui_kits/shell/Home.jsx":"d72feb7e1bf6","ui_kits/shell/data.js":"56f76621a915"},"inlinedExternals":[],"unexposedExports":[{"name":"t","sourcePath":"lib/i18n.js"}]} */

(() => {

const __ds_ns = (window.NosioDesignSystem_d76dec = window.NosioDesignSystem_d76dec || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Nesio Button — calm, tactile actions.
 * Variants: primary (filled blue), secondary (glass), soft (tonal), ghost (text).
 * Never shout. Destructive uses `tone="risk"` and is reserved for real risk.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  tone = 'brand',
  pill = false,
  full = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}) {
  const accent = tone === 'risk' ? 'var(--status-risk)' : 'var(--portal-blue-deep)';
  const sizes = {
    sm: {
      padding: '0.4rem 0.85rem',
      font: 'var(--text-sm)',
      gap: '0.35rem'
    },
    md: {
      padding: '0.6rem 1.15rem',
      font: 'var(--text-body)',
      gap: '0.45rem'
    },
    lg: {
      padding: '0.8rem 1.5rem',
      font: 'var(--text-h3)',
      gap: '0.55rem'
    }
  };
  const s = sizes[size] || sizes.md;
  const variants = {
    primary: {
      background: accent,
      color: '#fff',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-card)'
    },
    secondary: {
      background: 'var(--glass-bg-solid)',
      color: 'var(--portal-ink)',
      border: '1px solid var(--glass-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))'
    },
    soft: {
      background: tone === 'risk' ? 'var(--status-risk-soft)' : 'color-mix(in srgb, var(--portal-blue-light) 60%, transparent)',
      color: accent,
      border: '1px solid var(--glass-border)'
    },
    ghost: {
      background: 'transparent',
      color: accent,
      border: '1px solid transparent'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      fontFamily: 'var(--font-sans)',
      fontSize: s.font,
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1.1,
      padding: s.padding,
      minHeight: 'var(--tap-min)',
      width: full ? '100%' : 'auto',
      borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'transform var(--dur-fast) var(--ease-soft), box-shadow var(--dur) var(--ease-soft), background var(--dur) var(--ease-soft)',
      ...variants[variant],
      ...style
    },
    onPointerDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
    },
    onPointerUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onPointerLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/FloatingButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FloatingButton (FAB) — a single lightweight entry that floats over the
 * courtyard. Used for the 笔记 (note) and 智友 (AI) quick entries.
 * Circular glass by default; pass `label` for a pill.
 */
function FloatingButton({
  icon,
  label = '',
  accent = false,
  position = 'br',
  size = 56,
  style = {},
  ...rest
}) {
  const [press, setPress] = React.useState(false);
  const corner = {
    br: {
      right: 'var(--space-5)',
      bottom: 'calc(var(--space-5) + env(safe-area-inset-bottom))'
    },
    bl: {
      left: 'var(--space-5)',
      bottom: 'calc(var(--space-5) + env(safe-area-inset-bottom))'
    },
    tr: {
      right: 'var(--space-5)',
      top: 'var(--space-5)'
    },
    tl: {
      left: 'var(--space-5)',
      top: 'var(--space-5)'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onPointerDown: () => setPress(true),
    onPointerUp: () => setPress(false),
    onPointerLeave: () => setPress(false),
    style: {
      position: 'fixed',
      ...corner[position],
      zIndex: 60,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.5rem',
      height: size,
      minWidth: size,
      padding: label ? '0 1.1rem 0 0.9rem' : 0,
      justifyContent: 'center',
      borderRadius: 'var(--radius-pill)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-semibold)',
      color: accent ? '#fff' : 'var(--portal-blue-deep)',
      background: accent ? 'var(--portal-blue-deep)' : 'var(--glass-bg-pop)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
      border: accent ? '1px solid rgba(255,255,255,0.4)' : '1px solid var(--glass-border)',
      boxShadow: 'var(--shadow-fab)',
      transform: press ? 'scale(0.94)' : 'scale(1)',
      transition: 'transform var(--dur-fast) var(--ease-soft), box-shadow var(--dur) var(--ease-soft)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      fontSize: '1.25rem',
      lineHeight: 1
    }
  }, icon), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { FloatingButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/FloatingButton.jsx", error: String((e && e.message) || e) }); }

// components/core/GlassCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * GlassCard — the core liquid-glass surface.
 * Frosted panel that floats over the gradient. Optional zone tone
 * (cool / warm / neutral) tints it to one of the three cabins.
 */
function GlassCard({
  children,
  tone = 'plain',
  raised = false,
  interactive = false,
  padding = 'var(--space-5)',
  radius = 'var(--radius-lg)',
  style = {},
  ...rest
}) {
  const toneBg = {
    plain: 'var(--glass-bg-solid)',
    cool: 'color-mix(in srgb, var(--portal-cool) 88%, white)',
    warm: 'color-mix(in srgb, var(--portal-warm) 88%, white)',
    neutral: 'color-mix(in srgb, var(--portal-neutral) 88%, white)'
  };
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: 'relative',
      background: toneBg[tone] || toneBg.plain,
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
      border: '1px solid var(--glass-border)',
      borderRadius: radius,
      padding,
      boxShadow: raised || interactive && hover ? 'var(--shadow-raise), var(--glass-highlight)' : 'var(--shadow-card), var(--glass-highlight)',
      color: 'var(--portal-ink)',
      transition: 'transform var(--dur) var(--ease-soft), box-shadow var(--dur) var(--ease-soft), border-color var(--dur) var(--ease-soft)',
      transform: interactive && hover ? 'translateY(-3px)' : 'translateY(0)',
      cursor: interactive ? 'pointer' : 'default',
      ...style
    },
    onMouseEnter: () => interactive && setHover(true),
    onMouseLeave: () => interactive && setHover(false)
  }, rest), children);
}
Object.assign(__ds_scope, { GlassCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/GlassCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — quiet glass text field. Also renders a textarea via `multiline`.
 */
function Input({
  label = '',
  hint = '',
  multiline = false,
  rows = 3,
  value,
  onChange,
  placeholder = '',
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const Tag = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.35rem',
      fontFamily: 'var(--font-sans)'
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--portal-muted)'
    }
  }, label), /*#__PURE__*/React.createElement(Tag, _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    rows: multiline ? rows : undefined,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-body)',
      color: 'var(--portal-ink)',
      background: 'var(--glass-bg-solid)',
      border: `1px solid ${focus ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
      borderRadius: 'var(--radius-sm)',
      padding: '0.6rem 0.8rem',
      minHeight: multiline ? undefined : 'var(--tap-min)',
      outline: 'none',
      resize: multiline ? 'vertical' : undefined,
      boxShadow: focus ? '0 0 0 3px color-mix(in srgb, var(--portal-blue-deep) 16%, transparent)' : 'none',
      transition: 'border-color var(--dur-fast) var(--ease-soft), box-shadow var(--dur-fast) var(--ease-soft)',
      ...style
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.68rem',
      color: 'var(--portal-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusBadge.jsx
try { (() => {
/**
 * StatusBadge — warm-coach status pill.
 * Soft by default. `risk` (muted red) is reserved for genuine
 * expiry / safety signals only.
 */
function StatusBadge({
  status = 'calm',
  children,
  dot = false,
  style = {}
}) {
  const map = {
    go: {
      fg: 'var(--status-go)',
      bg: 'var(--status-go-soft)'
    },
    gentle: {
      fg: 'var(--status-gentle)',
      bg: 'var(--status-gentle-soft)'
    },
    calm: {
      fg: 'var(--status-calm)',
      bg: 'var(--status-calm-soft)'
    },
    risk: {
      fg: 'var(--status-risk)',
      bg: 'var(--status-risk-soft)'
    }
  };
  const c = map[status] || map.calm;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.35rem',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      color: c.fg,
      background: c.bg,
      padding: '0.22rem 0.6rem',
      borderRadius: 'var(--radius-pill)',
      lineHeight: 1.2,
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: c.fg,
      flex: 'none'
    }
  }), children);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/portal/QuoteCard.jsx
try { (() => {
/**
 * QuoteCard — 今日话语. A quiet serif line that lives at the bottom of the
 * home. Soft glass with a save affordance.
 */
function QuoteCard({
  quote = '',
  label = '今日话语',
  onSave,
  saved = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      background: 'linear-gradient(135deg, color-mix(in srgb, var(--portal-blue-light) 55%, transparent), var(--glass-bg-solid))',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4) var(--space-5)',
      color: 'var(--portal-ink)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-overline)',
      letterSpacing: 'var(--tracking-wide)',
      textTransform: 'uppercase',
      color: 'var(--portal-muted)',
      marginBottom: '0.4rem'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-h2)',
      fontWeight: 'var(--weight-regular)',
      lineHeight: 'var(--leading-relaxed)',
      opacity: 0.92
    }
  }, quote)), onSave && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onSave,
    "aria-label": "\u6536\u85CF\u8FD9\u53E5\u8BDD",
    style: {
      flex: 'none',
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-pill)',
      border: '1px solid var(--glass-border)',
      background: saved ? 'var(--portal-blue-deep)' : 'var(--glass-bg)',
      color: saved ? '#fff' : 'var(--portal-blue-deep)',
      cursor: 'pointer',
      fontSize: '1rem',
      display: 'grid',
      placeItems: 'center',
      transition: 'background var(--dur) var(--ease-soft)'
    }
  }, saved ? '♥' : '♡'));
}
Object.assign(__ds_scope, { QuoteCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/portal/QuoteCard.jsx", error: String((e && e.message) || e) }); }

// components/portal/ReminderCard.jsx
try { (() => {
/**
 * ReminderCard — "陪你看见" (I'll help you see).
 * A gentle, AI/DB-driven module that surfaces one small doable next step
 * at a time. Every item carries an escape: 跳过 / 稍后 / 更轻提醒.
 */
function ReminderCard({
  title = '陪你看见',
  subtitle = '',
  items = [],
  onAct,
  onSkip,
  onLater,
  style = {}
}) {
  const tone = {
    go: {
      fg: 'var(--status-go)',
      bg: 'var(--status-go-soft)'
    },
    gentle: {
      fg: 'var(--status-gentle)',
      bg: 'var(--status-gentle-soft)'
    },
    calm: {
      fg: 'var(--status-calm)',
      bg: 'var(--status-calm-soft)'
    },
    risk: {
      fg: 'var(--status-risk)',
      bg: 'var(--status-risk-soft)'
    }
  };
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--glass-bg-solid)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-5)',
      boxShadow: 'var(--shadow-card), var(--glass-highlight)',
      color: 'var(--portal-ink)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-h3)',
      fontWeight: 'var(--weight-semibold)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, subtitle)), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, items.map((it, i) => {
    const c = tone[it.status] || tone.calm;
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        background: c.bg
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 7,
        height: 7,
        borderRadius: 999,
        background: c.fg,
        marginTop: '0.5rem',
        flex: 'none'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, it.kind && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.64rem',
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        color: c.fg
      }
    }, it.kind), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '0.15rem 0 0',
        fontSize: 'var(--text-body)',
        lineHeight: 'var(--leading-snug)'
      }
    }, it.text))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
        paddingLeft: '1.3rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => onAct?.(it),
      style: btn(c.fg, true)
    }, it.action || '轻轻处理'), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => onLater?.(it),
      style: btn('var(--portal-muted)')
    }, "\u7A0D\u540E"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => onSkip?.(it),
      style: btn('var(--portal-muted)')
    }, "\u8DF3\u8FC7")));
  })));
}
function btn(color, filled = false) {
  return {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-medium)',
    color: filled ? '#fff' : color,
    background: filled ? color : 'transparent',
    border: filled ? '1px solid transparent' : '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-pill)',
    padding: '0.35rem 0.8rem',
    cursor: 'pointer'
  };
}
Object.assign(__ds_scope, { ReminderCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/portal/ReminderCard.jsx", error: String((e && e.message) || e) }); }

// components/portal/ToolModuleCard.jsx
try { (() => {
/**
 * ToolModuleCard — a paid/owned tool shown on the home as a LIVE content
 * window, not just a name. The icon + a faint name sit in the corner;
 * the body shows the tool's own glanceable signal (what's expiring, next
 * session, today's number…) passed as children.
 */
function ToolModuleCard({
  icon,
  name = '',
  nameEn = '',
  tone = 'cool',
  status = null,
  // { status, label } warm-coach badge
  locked = false,
  children,
  onOpen,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  const toneBg = {
    cool: 'color-mix(in srgb, var(--portal-cool) 88%, white)',
    warm: 'color-mix(in srgb, var(--portal-warm) 88%, white)',
    neutral: 'color-mix(in srgb, var(--portal-neutral) 88%, white)'
  };
  const accent = {
    cool: 'var(--portal-cool-accent)',
    warm: 'var(--portal-warm-accent)',
    neutral: 'var(--portal-neutral-accent)'
  }[tone];
  const badge = status && {
    go: {
      fg: 'var(--status-go)',
      bg: 'var(--status-go-soft)'
    },
    gentle: {
      fg: 'var(--status-gentle)',
      bg: 'var(--status-gentle-soft)'
    },
    calm: {
      fg: 'var(--status-calm)',
      bg: 'var(--status-calm-soft)'
    },
    risk: {
      fg: 'var(--status-risk)',
      bg: 'var(--status-risk-soft)'
    }
  }[status.status];
  return /*#__PURE__*/React.createElement("article", {
    onClick: onOpen,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      background: toneBg[tone] || toneBg.cool,
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      minHeight: '8.5rem',
      cursor: onOpen ? 'pointer' : 'default',
      color: 'var(--portal-ink)',
      boxShadow: hover ? 'var(--shadow-raise), var(--glass-highlight)' : 'var(--shadow-card), var(--glass-highlight)',
      transform: hover && onOpen ? 'translateY(-3px)' : 'translateY(0)',
      transition: 'transform var(--dur) var(--ease-soft), box-shadow var(--dur) var(--ease-soft)',
      opacity: locked ? 0.62 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 10,
      overflow: 'hidden',
      flex: 'none',
      display: 'grid',
      placeItems: 'center',
      fontSize: '1.2rem'
    }
  }, typeof icon === 'string' && icon.includes('.svg') ? /*#__PURE__*/React.createElement("img", {
    src: icon,
    alt: "",
    width: 34,
    height: 34,
    style: {
      borderRadius: 10
    }
  }) : icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--portal-muted)',
      letterSpacing: '0.02em'
    }
  }, name, nameEn ? ` · ${nameEn}` : ''), badge && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.66rem',
      fontWeight: 'var(--weight-semibold)',
      color: badge.fg,
      background: badge.bg,
      padding: '0.18rem 0.5rem',
      borderRadius: 'var(--radius-pill)',
      flex: 'none'
    }
  }, status.label), locked && !badge && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      fontSize: '0.8rem',
      color: 'var(--portal-muted)'
    }
  }, "\uD83D\uDD12")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '0.2rem'
    }
  }, children), onOpen && /*#__PURE__*/React.createElement("footer", {
    style: {
      fontSize: 'var(--text-xs)',
      color: accent,
      opacity: hover ? 1 : 0.7,
      transition: 'opacity var(--dur) var(--ease-soft)'
    }
  }, "\u8FDB\u5165 \u2192"));
}
Object.assign(__ds_scope, { ToolModuleCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/portal/ToolModuleCard.jsx", error: String((e && e.message) || e) }); }

// components/portal/WeatherTime.jsx
try { (() => {
/**
 * WeatherTime — top-right cluster on the home: clock, date, and a small
 * weather glance. Quiet glass chip.
 */
function WeatherTime({
  time = '',
  date = '',
  temp = '',
  condition = '',
  place = '',
  align = 'right',
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: align === 'right' ? 'flex-end' : 'flex-start',
      gap: '0.15rem',
      color: 'var(--portal-ink)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-h1)',
      fontWeight: 'var(--weight-semibold)',
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-0.02em',
      lineHeight: 1
    }
  }, time), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, date), (temp || condition) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.35rem',
      marginTop: '0.3rem',
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-blue-deep)',
      background: 'color-mix(in srgb, var(--portal-blue-light) 45%, transparent)',
      padding: '0.2rem 0.6rem',
      borderRadius: 'var(--radius-pill)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 'var(--weight-semibold)'
    }
  }, temp), condition && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--portal-muted)'
    }
  }, condition), place && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--portal-muted)'
    }
  }, "\xB7 ", place)));
}
Object.assign(__ds_scope, { WeatherTime });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/portal/WeatherTime.jsx", error: String((e && e.message) || e) }); }

// lib/i18n.js
try { (() => {
/* ───────────────────────────────────────────────────────────
   Nesio · 宝盒 — multilingual strings
   Languages: zh (简体中文) · en · ja (日本語) · ko (한국어)
   Usage:  import { t } from './i18n.js';  t('zh', 'shellBrand')
   The shell's source of truth currently ships zh + en; ja/ko here
   extend the system so new modules launch fully localized.
   ─────────────────────────────────────────────────────────── */

const LOCALES = ['zh', 'en', 'ja', 'ko'];
const LOCALE_LABELS = {
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어'
};
const STRINGS = {
  zh: {
    shellBrand: '宝盒',
    shellTagline: '数字静谧庭院',
    greetingMorning: '早安',
    greetingDay: '午安',
    greetingEvening: '晚安',
    settings: '账号设置',
    note: '笔记',
    ai: '智友',
    aiFull: 'AI 群聊',
    toolboxMore: '更多工具',
    toolbox: '宝盒工具',
    reminderTitle: '陪你看见',
    reminderSub: '基于你的数据',
    quoteLabel: '今日话语',
    saveQuote: '收藏这句话',
    actHandle: '轻轻处理',
    actLater: '稍后',
    actSkip: '跳过',
    actSave: '保存想法',
    enter: '进入',
    open: '打开',
    locked: '未开通',
    themeDay: '日',
    themeNight: '夜',
    themeAuto: '随系统',
    notReady: '待就绪',
    ready: '已就绪',
    gated: '待授权',
    external: '外部入口',
    expiringSoon: '即将到期',
    nextStep: '下一步',
    importantDate: '重要日期'
  },
  en: {
    shellBrand: 'Treasure Box',
    shellTagline: 'A quiet digital courtyard',
    greetingMorning: 'Good morning',
    greetingDay: 'Good afternoon',
    greetingEvening: 'Good evening',
    settings: 'Account',
    note: 'Notes',
    ai: 'AI Friends',
    aiFull: 'AI group chat',
    toolboxMore: 'More tools',
    toolbox: 'Toolbox',
    reminderTitle: 'Here with you',
    reminderSub: 'From your data',
    quoteLabel: 'Daily quote',
    saveQuote: 'Save quote',
    actHandle: 'Gently handle',
    actLater: 'Later',
    actSkip: 'Skip',
    actSave: 'Save the thought',
    enter: 'Enter',
    open: 'Open',
    locked: 'Locked',
    themeDay: 'Day',
    themeNight: 'Night',
    themeAuto: 'Auto',
    notReady: 'Not ready',
    ready: 'Ready',
    gated: 'Awaiting approval',
    external: 'External',
    expiringSoon: 'Expiring soon',
    nextStep: 'Next step',
    importantDate: 'Important date'
  },
  ja: {
    shellBrand: '宝箱',
    shellTagline: '静かなデジタルの庭',
    greetingMorning: 'おはよう',
    greetingDay: 'こんにちは',
    greetingEvening: 'こんばんは',
    settings: 'アカウント設定',
    note: 'ノート',
    ai: 'AIフレンド',
    aiFull: 'AIグループチャット',
    toolboxMore: 'その他のツール',
    toolbox: 'ツールボックス',
    reminderTitle: 'そばで見守る',
    reminderSub: 'あなたのデータから',
    quoteLabel: '今日の言葉',
    saveQuote: 'この言葉を保存',
    actHandle: 'そっと片づける',
    actLater: 'あとで',
    actSkip: 'スキップ',
    actSave: '思いを保存',
    enter: '開く',
    open: '開く',
    locked: '未開放',
    themeDay: '昼',
    themeNight: '夜',
    themeAuto: '自動',
    notReady: '準備中',
    ready: '準備完了',
    gated: '承認待ち',
    external: '外部',
    expiringSoon: 'まもなく期限',
    nextStep: '次の一歩',
    importantDate: '大切な日'
  },
  ko: {
    shellBrand: '보물상자',
    shellTagline: '고요한 디지털 정원',
    greetingMorning: '좋은 아침',
    greetingDay: '안녕하세요',
    greetingEvening: '좋은 저녁',
    settings: '계정 설정',
    note: '노트',
    ai: 'AI 친구',
    aiFull: 'AI 그룹 채팅',
    toolboxMore: '더 많은 도구',
    toolbox: '도구 상자',
    reminderTitle: '함께 살펴봐요',
    reminderSub: '당신의 데이터로',
    quoteLabel: '오늘의 한마디',
    saveQuote: '이 문장 저장',
    actHandle: '가볍게 처리',
    actLater: '나중에',
    actSkip: '건너뛰기',
    actSave: '생각 저장',
    enter: '들어가기',
    open: '열기',
    locked: '미개방',
    themeDay: '낮',
    themeNight: '밤',
    themeAuto: '자동',
    notReady: '준비 중',
    ready: '준비됨',
    gated: '승인 대기',
    external: '외부',
    expiringSoon: '곧 만료',
    nextStep: '다음 단계',
    importantDate: '중요한 날'
  }
};
function t(locale, key) {
  const L = STRINGS[locale] || STRINGS.zh;
  return L[key] ?? STRINGS.zh[key] ?? key;
}
Object.assign(__ds_scope, { LOCALES, LOCALE_LABELS, STRINGS, t });
})(); } catch (e) { __ds_ns.__errors.push({ path: "lib/i18n.js", error: String((e && e.message) || e) }); }

// ui_kits/shell/Home.jsx
try { (() => {
/* Nesio · 宝盒 — Home shell screen.
   Composes the design-system components over the liquid-glass courtyard. */
const {
  ToolModuleCard,
  ReminderCard,
  QuoteCard,
  WeatherTime,
  FloatingButton,
  Button
} = window.NosioDesignSystem_d76dec;
const TOOL_ICON = i => `../../assets/icons/tools/${i}.svg`;
const AI_ICON = i => `../../assets/icons/ai/${i}.svg`;
function Home() {
  const [locale, setLocale] = React.useState('zh');
  const [theme, setTheme] = React.useState('day');
  const [sheet, setSheet] = React.useState(null); // 'toolbox' | 'ai' | 'note' | null
  const [savedQuote, setSavedQuote] = React.useState(false);
  const [aiPicked, setAiPicked] = React.useState(['claude', 'chatgpt', 'gemini']);
  const T = NESIO_I18N[locale];
  React.useEffect(() => {
    document.documentElement.setAttribute('data-portal-theme', theme);
    document.documentElement.setAttribute('lang', locale);
  }, [theme, locale]);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? T.morning : hour < 18 ? T.day : T.evening;
  const localeCode = {
    zh: 'zh-CN',
    en: 'en-US',
    ja: 'ja-JP',
    ko: 'ko-KR'
  }[locale];
  const time = now.toLocaleTimeString(localeCode, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const date = now.toLocaleDateString(localeCode, {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
  const quote = NESIO_QUOTES[locale][now.getDate() % NESIO_QUOTES[locale].length];
  const owned = NESIO_TOOLS.filter(t => t.owned);
  const toggleAi = id => setAiPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 460,
      margin: '0 auto',
      padding: '0 16px 110px',
      position: 'relative',
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: '20px 2px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setSheet('settings'),
    title: T.settings,
    style: avatarStyle
  }, "\u5A67"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-h3)',
      fontWeight: 'var(--weight-semibold)'
    }
  }, greeting, "\uFF0C\u5A67"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, T.tagline))), /*#__PURE__*/React.createElement(WeatherTime, {
    time: time,
    date: date,
    temp: "24\xB0",
    condition: locale === 'zh' ? '多云' : 'Cloudy',
    place: locale === 'zh' ? '上海' : 'SH'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginBottom: 18,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(ThemeToggle, {
    theme: theme,
    setTheme: setTheme,
    T: T
  }), /*#__PURE__*/React.createElement(LangSwitch, {
    locale: locale,
    setLocale: setLocale
  })), /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 16
    }
  }, owned.map(tool => /*#__PURE__*/React.createElement(ToolModuleCard, {
    key: tool.id,
    icon: TOOL_ICON(tool.icon),
    name: tool.name[locale],
    nameEn: tool.en,
    tone: tool.zone,
    status: tool.badge ? {
      status: tool.badge.status,
      label: tool.badge.label[locale]
    } : null,
    onOpen: () => {}
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 'var(--text-h3)',
      lineHeight: 1.25
    }
  }, tool.signal[locale]), tool.sub && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--portal-muted)',
      fontSize: 'var(--text-xs)'
    }
  }, tool.sub[locale]))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSheet('toolbox'),
    style: moreCardStyle
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 28,
      lineHeight: 1
    }
  }, "\u2295"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-semibold)'
    }
  }, T.toolboxMore), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, NESIO_TOOLS.length, " \u4E2A\u5DE5\u5177"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(ReminderCard, {
    title: T.reminder,
    subtitle: T.reminderSub,
    items: NESIO_REMINDERS[locale]
  })), /*#__PURE__*/React.createElement(QuoteCard, {
    quote: quote,
    label: T.quoteLabel,
    saved: savedQuote,
    onSave: () => setSavedQuote(s => !s)
  }), /*#__PURE__*/React.createElement(FloatingButton, {
    icon: "\u270E",
    position: "bl",
    onClick: () => setSheet('note')
  }), /*#__PURE__*/React.createElement(FloatingButton, {
    icon: "\uD83D\uDCAC",
    accent: true,
    label: T.ai,
    position: "br",
    onClick: () => setSheet('ai')
  }), /*#__PURE__*/React.createElement("nav", {
    style: bottomNavStyle
  }, [['🏠', T.navHome, true], ['✎', T.navNote, false], ['◷', T.navTodo, false], ['◍', T.navMe, false]].map(([ic, lb, active], i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => {
      if (lb === T.navNote) setSheet('note');
    },
    style: navBtnStyle(active)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      lineHeight: 1
    }
  }, ic), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.6rem'
    }
  }, lb)))), sheet === 'toolbox' && /*#__PURE__*/React.createElement(ToolboxSheet, {
    locale: locale,
    onClose: () => setSheet(null)
  }), sheet === 'ai' && /*#__PURE__*/React.createElement(AISheet, {
    locale: locale,
    picked: aiPicked,
    toggle: toggleAi,
    onClose: () => setSheet(null)
  }), sheet === 'note' && /*#__PURE__*/React.createElement(NoteSheet, {
    locale: locale,
    onClose: () => setSheet(null)
  }), sheet === 'settings' && /*#__PURE__*/React.createElement(SettingsSheet, {
    locale: locale,
    setLocale: setLocale,
    theme: theme,
    setTheme: setTheme,
    onClose: () => setSheet(null)
  }));
}

/* ── small UI helpers ── */
function ThemeToggle({
  theme,
  setTheme,
  T
}) {
  const opts = [['day', '☀', T.navHome === 'Home' ? 'Day' : '日'], ['night', '☾', T.navHome === 'Home' ? 'Night' : '夜']];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-pill)',
      padding: 3,
      backdropFilter: 'blur(8px)'
    }
  }, opts.map(([v, ic, lb]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setTheme(v),
    style: {
      border: 'none',
      cursor: 'pointer',
      borderRadius: 999,
      padding: '5px 12px',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      display: 'inline-flex',
      gap: 5,
      alignItems: 'center',
      background: theme === v ? 'var(--portal-blue-deep)' : 'transparent',
      color: theme === v ? '#fff' : 'var(--portal-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, ic), /*#__PURE__*/React.createElement("span", null, lb))));
}
function LangSwitch({
  locale,
  setLocale
}) {
  const labels = {
    zh: '中',
    en: 'EN',
    ja: '日',
    ko: '한'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-pill)',
      padding: 3,
      backdropFilter: 'blur(8px)'
    }
  }, ['zh', 'en', 'ja', 'ko'].map(l => /*#__PURE__*/React.createElement("button", {
    key: l,
    onClick: () => setLocale(l),
    style: {
      border: 'none',
      cursor: 'pointer',
      borderRadius: 999,
      padding: '5px 11px',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      background: locale === l ? 'var(--portal-blue-deep)' : 'transparent',
      color: locale === l ? '#fff' : 'var(--portal-muted)'
    }
  }, labels[l])));
}

/* ── styles ── */
const avatarStyle = {
  width: 44,
  height: 44,
  borderRadius: 'var(--radius-pill)',
  flex: 'none',
  border: '1px solid var(--glass-border)',
  cursor: 'pointer',
  background: 'linear-gradient(145deg, var(--portal-blue-light), var(--portal-blue-mid))',
  color: 'var(--portal-blue-deep)',
  fontFamily: 'var(--font-serif)',
  fontWeight: 600,
  fontSize: '1.1rem'
};
const moreCardStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: '8.5rem',
  cursor: 'pointer',
  color: 'var(--portal-blue-deep)',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px dashed var(--glass-border)',
  borderRadius: 'var(--radius-lg)'
};
const bottomNavStyle = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 'calc(12px + env(safe-area-inset-bottom))',
  zIndex: 55,
  display: 'flex',
  gap: 4,
  width: 'min(420px, calc(100% - 32px))',
  justifyContent: 'space-around',
  background: 'var(--glass-bg-pop)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-pill)',
  padding: '6px',
  boxShadow: 'var(--shadow-pop)'
};
function navBtnStyle(active) {
  return {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '7px 0',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 'var(--radius-pill)',
    fontWeight: 600,
    background: active ? 'color-mix(in srgb, var(--portal-blue-light) 55%, transparent)' : 'transparent',
    color: active ? 'var(--portal-blue-deep)' : 'var(--portal-muted)'
  };
}

/* ── Sheet shell ── */
function Sheet({
  title,
  onClose,
  children,
  height = '74vh'
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 80,
      background: 'rgba(18,32,58,0.32)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: 'min(460px, 100%)',
      maxHeight: height,
      overflowY: 'auto',
      background: 'var(--glass-bg-pop)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
      borderTopLeftRadius: 'var(--radius-xl)',
      borderTopRightRadius: 'var(--radius-xl)',
      border: '1px solid var(--glass-border)',
      boxShadow: 'var(--shadow-pop)',
      padding: '14px 18px calc(22px + env(safe-area-inset-bottom))',
      animation: 'nesio-fade-in 0.3s var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 38,
      height: 4,
      borderRadius: 999,
      background: 'var(--portal-line)',
      margin: '0 auto 14px'
    }
  }), /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--text-h2)',
      fontWeight: 600,
      color: 'var(--portal-ink)'
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      border: 'none',
      background: 'var(--glass-bg)',
      width: 32,
      height: 32,
      borderRadius: 999,
      cursor: 'pointer',
      color: 'var(--portal-muted)',
      fontSize: 18
    }
  }, "\xD7")), children));
}
function ToolboxSheet({
  locale,
  onClose
}) {
  const T = NESIO_I18N[locale];
  return /*#__PURE__*/React.createElement(Sheet, {
    title: `${T.toolbox} · ${NESIO_TOOLS.length}`,
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 14
    }
  }, NESIO_TOOLS.map(tool => /*#__PURE__*/React.createElement("div", {
    key: tool.id,
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      opacity: tool.owned ? 1 : 0.55
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: TOOL_ICON(tool.icon),
    alt: "",
    width: 48,
    height: 48,
    style: {
      borderRadius: 13
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-ink)',
      textAlign: 'center'
    }
  }, tool.name[locale]), !tool.owned && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.56rem',
      color: 'var(--portal-muted)'
    }
  }, "\uD83D\uDD12")))));
}
function AISheet({
  locale,
  picked,
  toggle,
  onClose
}) {
  const T = NESIO_I18N[locale];
  const [msg, setMsg] = React.useState('');
  return /*#__PURE__*/React.createElement(Sheet, {
    title: T.ai,
    onClose: onClose,
    height: "80vh"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, T.aiHint), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 16
    }
  }, NESIO_AIS.map(ai => {
    const on = picked.includes(ai.id);
    return /*#__PURE__*/React.createElement("button", {
      key: ai.id,
      onClick: () => toggle(ai.id),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 13px 7px 8px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${on ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
        background: on ? 'color-mix(in srgb, var(--portal-blue-light) 50%, transparent)' : 'var(--glass-bg)',
        color: 'var(--portal-ink)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: AI_ICON(ai.icon),
      alt: "",
      width: 22,
      height: 22,
      style: {
        borderRadius: 6
      }
    }), ai.name);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Bubble, {
    who: NESIO_AIS.find(a => a.id === picked[0])?.name || 'AI',
    icon: picked[0],
    text: {
      zh: '今晚的待办我帮你按精力排了序，先做最轻的一件好吗？',
      en: "I've sorted tonight's to-dos by energy — start with the lightest?",
      ja: '今夜のタスクをエネルギー順に並べたよ。一番軽いのから始める？',
      ko: '오늘 저녁 할 일을 에너지 순으로 정리했어요. 가장 가벼운 것부터 할까요?'
    }[locale]
  }), /*#__PURE__*/React.createElement(Bubble, {
    who: NESIO_AIS.find(a => a.id === picked[1])?.name || 'AI',
    icon: picked[1],
    text: {
      zh: '补充一句：买牛奶可以顺路，不用专门跑。',
      en: 'One add: grab milk on the way — no special trip needed.',
      ja: '一言：牛乳はついでで大丈夫、わざわざ行かなくても。',
      ko: '한마디: 우유는 지나는 길에 — 따로 갈 필요 없어요.'
    }[locale],
    align: "right"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: msg,
    onChange: e => setMsg(e.target.value),
    placeholder: NESIO_I18N[locale].notePlaceholder,
    style: {
      flex: 1,
      fontFamily: 'inherit',
      fontSize: 'var(--text-body)',
      color: 'var(--portal-ink)',
      background: 'var(--glass-bg-solid)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-pill)',
      padding: '11px 16px',
      outline: 'none'
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    pill: true,
    onClick: () => setMsg('')
  }, T.send)));
}
function Bubble({
  who,
  icon,
  text,
  align = 'left'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: align === 'right' ? 'flex-end' : 'flex-start',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: '0.64rem',
      color: 'var(--portal-muted)'
    }
  }, icon && /*#__PURE__*/React.createElement("img", {
    src: AI_ICON(icon),
    alt: "",
    width: 14,
    height: 14,
    style: {
      borderRadius: 4
    }
  }), who), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '82%',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.5,
      color: 'var(--portal-ink)',
      padding: '9px 13px',
      borderRadius: 'var(--radius-md)',
      background: align === 'right' ? 'color-mix(in srgb, var(--portal-blue-light) 55%, transparent)' : 'var(--glass-bg-solid)',
      border: '1px solid var(--glass-border)'
    }
  }, text));
}
function NoteSheet({
  locale,
  onClose
}) {
  const T = NESIO_I18N[locale];
  const [val, setVal] = React.useState('');
  return /*#__PURE__*/React.createElement(Sheet, {
    title: T.note,
    onClose: onClose,
    height: "60vh"
  }, /*#__PURE__*/React.createElement("textarea", {
    value: val,
    onChange: e => setVal(e.target.value),
    placeholder: T.notePlaceholder,
    rows: 5,
    style: {
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 'var(--text-body)',
      lineHeight: 1.6,
      color: 'var(--portal-ink)',
      background: 'var(--glass-bg-solid)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-md)',
      padding: 14,
      outline: 'none',
      resize: 'none',
      marginBottom: 12
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 'var(--text-xs)',
      color: 'var(--portal-muted)'
    }
  }, {
    zh: '笔记只是一个入口 — 可以连接 flomo、Notion，或用宝盒自己的。',
    en: 'Notes is just an entry — link flomo, Notion, or use Nesio\u2019s own.',
    ja: 'ノートは入口だけ — flomoやNotion、宝箱自身も使えます。',
    ko: '노트는 입구일 뿐 — flomo, Notion 또는 보물상자 자체를 쓸 수 있어요.'
  }[locale]), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onClose
  }, T.later), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => {
      setVal('');
      onClose();
    }
  }, T.send)));
}
function SettingsSheet({
  locale,
  setLocale,
  theme,
  setTheme,
  onClose
}) {
  const T = NESIO_I18N[locale];
  const labels = {
    zh: '简体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어'
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    title: T.settings,
    onClose: onClose,
    height: "64vh"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: rowLabel
  }, {
    zh: '显示语言',
    en: 'Language',
    ja: '表示言語',
    ko: '표시 언어'
  }[locale]), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, ['zh', 'en', 'ja', 'ko'].map(l => /*#__PURE__*/React.createElement("button", {
    key: l,
    onClick: () => setLocale(l),
    style: chipStyle(locale === l)
  }, labels[l])))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: rowLabel
  }, {
    zh: '外观',
    en: 'Appearance',
    ja: '外観',
    ko: '외관'
  }[locale]), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, [['day', T.navHome === 'Home' ? 'Day' : '日间'], ['night', T.navHome === 'Home' ? 'Night' : '夜间'], ['auto', T.navHome === 'Home' ? 'Auto' : '随系统']].map(([v, lb]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setTheme(v === 'auto' ? 'day' : v),
    style: chipStyle(theme === v)
  }, lb))))));
}
const rowLabel = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--portal-muted)',
  marginBottom: 8,
  letterSpacing: '0.02em'
};
function chipStyle(on) {
  return {
    padding: '9px 16px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    border: `1px solid ${on ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
    background: on ? 'var(--portal-blue-deep)' : 'var(--glass-bg)',
    color: on ? '#fff' : 'var(--portal-ink)'
  };
}
window.Home = Home;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/shell/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/shell/data.js
try { (() => {
// Nesio shell — demo data (tools, AIs, reminders, quotes) + i18n
const NESIO_I18N = {
  zh: {
    brand: '宝盒',
    tagline: '数字静谧庭院',
    morning: '早安',
    day: '午安',
    evening: '晚安',
    settings: '账号设置',
    note: '笔记',
    ai: '智友',
    toolboxMore: '更多',
    toolbox: '宝盒工具',
    reminder: '陪你看见',
    reminderSub: '基于你的数据 · 今天',
    quoteLabel: '今日话语',
    handle: '轻轻处理',
    later: '稍后',
    skip: '跳过',
    enter: '进入',
    locked: '未开通 · 在工具箱开启',
    navHome: '宝盒',
    navNote: '笔记',
    navTodo: '待办',
    navMe: '我',
    groupChat: '群聊',
    send: '发送',
    aiHint: '让多个 AI 一起回答，省得来回复制',
    notePlaceholder: '现在的想法是…'
  },
  en: {
    brand: 'Treasure Box',
    tagline: 'A quiet digital courtyard',
    morning: 'Good morning',
    day: 'Good afternoon',
    evening: 'Good evening',
    settings: 'Account',
    note: 'Notes',
    ai: 'AI Friends',
    toolboxMore: 'More',
    toolbox: 'Toolbox',
    reminder: 'Here with you',
    reminderSub: 'From your data · today',
    quoteLabel: 'Daily quote',
    handle: 'Gently handle',
    later: 'Later',
    skip: 'Skip',
    enter: 'Enter',
    locked: 'Locked · open in toolbox',
    navHome: 'Home',
    navNote: 'Notes',
    navTodo: 'To-do',
    navMe: 'Me',
    groupChat: 'Group',
    send: 'Send',
    aiHint: 'Ask several AIs at once — no more copy-pasting',
    notePlaceholder: 'What are you thinking…'
  },
  ja: {
    brand: '宝箱',
    tagline: '静かなデジタルの庭',
    morning: 'おはよう',
    day: 'こんにちは',
    evening: 'こんばんは',
    settings: 'アカウント',
    note: 'ノート',
    ai: 'AIフレンド',
    toolboxMore: 'その他',
    toolbox: 'ツールボックス',
    reminder: 'そばで見守る',
    reminderSub: 'あなたのデータから · 今日',
    quoteLabel: '今日の言葉',
    handle: 'そっと片づける',
    later: 'あとで',
    skip: 'スキップ',
    enter: '開く',
    locked: '未開放 · ツールボックスで開く',
    navHome: 'ホーム',
    navNote: 'ノート',
    navTodo: 'タスク',
    navMe: 'マイ',
    groupChat: 'グループ',
    send: '送信',
    aiHint: '複数のAIにまとめて質問。コピペ不要',
    notePlaceholder: 'いま考えていることは…'
  },
  ko: {
    brand: '보물상자',
    tagline: '고요한 디지털 정원',
    morning: '좋은 아침',
    day: '안녕하세요',
    evening: '좋은 저녁',
    settings: '계정',
    note: '노트',
    ai: 'AI 친구',
    toolboxMore: '더보기',
    toolbox: '도구 상자',
    reminder: '함께 살펴봐요',
    reminderSub: '당신의 데이터로 · 오늘',
    quoteLabel: '오늘의 한마디',
    handle: '가볍게 처리',
    later: '나중에',
    skip: '건너뛰기',
    enter: '들어가기',
    locked: '미개방 · 도구 상자에서 열기',
    navHome: '홈',
    navNote: '노트',
    navTodo: '할 일',
    navMe: '나',
    groupChat: '그룹',
    send: '보내기',
    aiHint: '여러 AI에게 한 번에 — 복사 붙여넣기 끝',
    notePlaceholder: '지금 떠오르는 생각은…'
  }
};

// 11 modules from the live shell config. zone: cool 秩序 / warm 觉察 / neutral 体现
const NESIO_TOOLS = [{
  id: 'plan',
  name: {
    zh: '待办',
    en: 'Flow',
    ja: 'タスク',
    ko: '할 일'
  },
  en: 'Flow',
  icon: 'plan',
  zone: 'cool',
  owned: true,
  signal: {
    zh: '今天 5 件 · 先做最小的一件',
    en: '5 today · start tiny',
    ja: '今日5件 · 小さく',
    ko: '오늘 5개 · 작게'
  },
  badge: {
    status: 'gentle',
    label: {
      zh: '刚刚好',
      en: 'just right',
      ja: 'ちょうど',
      ko: '딱 좋아요'
    }
  }
}, {
  id: 'inventory',
  name: {
    zh: '收纳',
    en: 'Storage',
    ja: '収納',
    ko: '수납'
  },
  en: 'Storage',
  icon: 'storage',
  zone: 'cool',
  owned: true,
  signal: {
    zh: '牛奶 · 酸奶 · 鸡蛋',
    en: 'Milk · yogurt · eggs',
    ja: '牛乳 · ヨーグルト · 卵',
    ko: '우유 · 요거트 · 계란'
  },
  sub: {
    zh: '3 天内到期',
    en: 'expiring in 3 days',
    ja: '3日以内に期限',
    ko: '3일 내 만료'
  },
  badge: {
    status: 'risk',
    label: {
      zh: '3 件将到期',
      en: '3 expiring',
      ja: '3件期限',
      ko: '3건 만료'
    }
  }
}, {
  id: 'reading',
  name: {
    zh: '阅读',
    en: 'Reading',
    ja: '読書',
    ko: '독서'
  },
  en: 'Reading',
  icon: 'reading',
  zone: 'warm',
  owned: true,
  signal: {
    zh: '《被讨厌的勇气》',
    en: 'The Courage to Be Disliked',
    ja: '嫌われる勇気',
    ko: '미움받을 용기'
  },
  sub: {
    zh: '读到 62% · 还剩 2 章',
    en: '62% · 2 chapters left',
    ja: '62% · 残り2章',
    ko: '62% · 2장 남음'
  },
  badge: {
    status: 'go',
    label: {
      zh: '在路上',
      en: 'on track',
      ja: '順調',
      ko: '순조'
    }
  }
}, {
  id: 'fitness',
  name: {
    zh: '健身',
    en: 'Fitness',
    ja: 'フィットネス',
    ko: '피트니스'
  },
  en: 'Fitness',
  icon: 'fitness',
  zone: 'neutral',
  owned: true,
  signal: {
    zh: '今天 · 下肢',
    en: 'Today · legs',
    ja: '今日 · 下半身',
    ko: '오늘 · 하체'
  },
  sub: {
    zh: '约 28 分钟',
    en: '~28 min',
    ja: '約28分',
    ko: '약 28분'
  },
  badge: {
    status: 'go',
    label: {
      zh: '连续 5 天',
      en: '5-day streak',
      ja: '5日連続',
      ko: '5일 연속'
    }
  }
}, {
  id: 'secretary',
  name: {
    zh: '智友',
    en: 'AI Friends',
    ja: 'AIフレンド',
    ko: 'AI 친구'
  },
  en: 'AI Friends',
  icon: 'secretary',
  zone: 'cool',
  owned: false
}, {
  id: 'quiz',
  name: {
    zh: '刷题',
    en: 'Quiz',
    ja: '問題演習',
    ko: '문제풀이'
  },
  en: 'Quiz',
  icon: 'quiz',
  zone: 'cool',
  owned: false
}, {
  id: 'psychoanalysis',
  name: {
    zh: '咨询',
    en: 'Psych',
    ja: 'カウンセリング',
    ko: '상담'
  },
  en: 'Psych',
  icon: 'psych',
  zone: 'warm',
  owned: false
}, {
  id: 'sanctuary',
  name: {
    zh: '冥想',
    en: 'Shelter',
    ja: '瞑想',
    ko: '명상'
  },
  en: 'Shelter',
  icon: 'sanctuary',
  zone: 'warm',
  owned: false
}, {
  id: 'health',
  name: {
    zh: '溯',
    en: 'SÙ Health',
    ja: '溯',
    ko: '溯'
  },
  en: 'SÙ Health',
  icon: 'health',
  zone: 'neutral',
  owned: false
}, {
  id: 'finance',
  name: {
    zh: '财务',
    en: 'Finance',
    ja: '家計',
    ko: '재무'
  },
  en: 'Finance',
  icon: 'finance',
  zone: 'neutral',
  owned: false
}, {
  id: 'lifesim',
  name: {
    zh: '人生',
    en: 'Weaver',
    ja: '人生',
    ko: '인생'
  },
  en: 'Weaver',
  icon: 'lifesim',
  zone: 'neutral',
  owned: false
}];
const NESIO_AIS = [{
  id: 'claude',
  name: 'Claude',
  icon: 'claude'
}, {
  id: 'chatgpt',
  name: 'ChatGPT',
  icon: 'chatgpt'
}, {
  id: 'gemini',
  name: 'Gemini',
  icon: 'gemini'
}, {
  id: 'deepseek',
  name: 'DeepSeek',
  icon: 'deepseek'
}, {
  id: 'doubao',
  name: '豆包',
  icon: 'doubao'
}, {
  id: 'grok',
  name: 'Grok',
  icon: 'grok'
}];
const NESIO_REMINDERS = {
  zh: [{
    kind: '重要日期',
    text: '妈妈的生日还有 3 天，要不要先想个小礼物？',
    status: 'calm',
    action: '记一笔'
  }, {
    kind: '下一步',
    text: '把昨天的想法保存下来，明天再决定也可以。',
    status: 'gentle',
    action: '保存想法'
  }, {
    kind: '到期',
    text: '冰箱里的牛奶 3 天后到期，需要的话顺路买点。',
    status: 'risk',
    action: '查看收纳'
  }],
  en: [{
    kind: 'Important date',
    text: "Mom's birthday is in 3 days — want to jot down a small gift idea?",
    status: 'calm',
    action: 'Note it'
  }, {
    kind: 'Next step',
    text: "Save yesterday's thought. You can decide tomorrow.",
    status: 'gentle',
    action: 'Save'
  }, {
    kind: 'Expiring',
    text: 'Milk expires in 3 days — grab some if you pass by.',
    status: 'risk',
    action: 'Open storage'
  }],
  ja: [{
    kind: '大切な日',
    text: 'お母さんの誕生日まであと3日。小さな贈り物を考えてみる？',
    status: 'calm',
    action: 'メモ'
  }, {
    kind: '次の一歩',
    text: '昨日の思いつきを保存しよう。決めるのは明日でも大丈夫。',
    status: 'gentle',
    action: '保存'
  }, {
    kind: '期限',
    text: '牛乳があと3日で期限。通りがかりに買ってもいいかも。',
    status: 'risk',
    action: '収納を見る'
  }],
  ko: [{
    kind: '중요한 날',
    text: '엄마 생신이 3일 남았어요. 작은 선물 아이디어를 적어둘까요?',
    status: 'calm',
    action: '메모'
  }, {
    kind: '다음 단계',
    text: '어제의 생각을 저장해요. 결정은 내일 해도 괜찮아요.',
    status: 'gentle',
    action: '저장'
  }, {
    kind: '만료',
    text: '우유가 3일 후 만료돼요. 지나는 길에 사도 좋아요.',
    status: 'risk',
    action: '수납 보기'
  }]
};
const NESIO_QUOTES = {
  zh: ['把大事拆小，把今天过好就够了。', '你已经做得很好了，休息也是前进。', '允许自己不确定，答案会在路上长出来。', '慢一点，深一点，稳一点。'],
  en: ['Break the big into small — making today good is enough.', "You've done well. Resting is also moving forward.", 'Allow yourself uncertainty; answers grow along the way.', 'Slower, deeper, steadier.'],
  ja: ['大きなことは小さく。今日をちゃんと過ごせれば十分。', 'もう十分よくやっている。休むことも前進。', '不確かさを許して。答えは道の途中で育つ。', 'ゆっくり、深く、穏やかに。'],
  ko: ['큰 일은 작게. 오늘을 잘 보내면 충분해요.', '이미 충분히 잘했어요. 쉬는 것도 나아가는 거예요.', '불확실함을 허락해요. 답은 길 위에서 자라요.', '천천히, 깊게, 차분하게.']
};
Object.assign(window, {
  NESIO_I18N,
  NESIO_TOOLS,
  NESIO_AIS,
  NESIO_REMINDERS,
  NESIO_QUOTES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/shell/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.FloatingButton = __ds_scope.FloatingButton;

__ds_ns.GlassCard = __ds_scope.GlassCard;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.QuoteCard = __ds_scope.QuoteCard;

__ds_ns.ReminderCard = __ds_scope.ReminderCard;

__ds_ns.ToolModuleCard = __ds_scope.ToolModuleCard;

__ds_ns.WeatherTime = __ds_scope.WeatherTime;

__ds_ns.LOCALES = __ds_scope.LOCALES;

__ds_ns.LOCALE_LABELS = __ds_scope.LOCALE_LABELS;

__ds_ns.STRINGS = __ds_scope.STRINGS;

})();
