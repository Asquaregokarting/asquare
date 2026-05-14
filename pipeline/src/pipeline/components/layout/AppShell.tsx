import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Play,
  QrCode,
  Upload,
  UserPlus
} from "lucide-react";
import { Role, ThemeMode } from "../../api/types";
import { ActionConfig } from "../../features/dashboard/role-config";
import { rolePathMap } from "../../features/dashboard/role-config";
import { isPathAllowedForRole } from "../../features/navigation/action-route-map";
import { getTabForPath } from "../../features/navigation/module-manifest";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

// Icon registry for the quick-action FAB. Keys mirror `ActionConfig.icon`
// in role-config.ts. Adding a new option means: add it there, add the
// import + entry here. Falling through to `null` renders the FAB as
// label-only (preserves the pre-icon look for any role that hasn't been
// updated yet).
const FAB_ICON_REGISTRY = {
  "layout-dashboard": LayoutDashboard,
  "user-plus": UserPlus,
  play: Play,
  "credit-card": CreditCard,
  "qr-code": QrCode,
  "clipboard-list": ClipboardList,
  upload: Upload,
  activity: Activity
} as const;

interface AppShellProps {
  role: Role;
  userName: string;
  navItems: Array<{ label: string; href: string }>;
  primaryActions: ActionConfig[];
  quickFabAction: ActionConfig;
  quickFabHref?: string;
  mobileShortcuts?: Array<{ label: string; href: string }>;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export const AppShell = ({
  role,
  userName,
  navItems,
  primaryActions: _primaryActions,
  quickFabAction,
  quickFabHref,
  themeMode,
  onCycleTheme,
  onLogout,
  children
}: AppShellProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navigationAnnouncement, setNavigationAnnouncement] = useState("");

  const drawerId = "mobile-navigation-drawer";
  const collapseSidebar = role === "Cashier";

  // ── Draggable FAB state ────────────────────────────────────────────────
  // The FAB can be picked up and moved anywhere on the screen. Position is
  // persisted to localStorage so it stays put across reloads. `null` means
  // "use the default bottom-6 right-6 CSS anchor" — once the user drags,
  // we switch to inline-style absolute coords.
  const FAB_STORAGE_KEY = "asquare.fab.position.v1";
  const FAB_MARGIN = 8; // px from any viewport edge
  const FAB_DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag
  const fabButtonRef = useRef<HTMLButtonElement | null>(null);
  const fabDragRef = useRef<{
    pointerStartX: number;
    pointerStartY: number;
    elementStartX: number;
    elementStartY: number;
    moved: boolean;
  } | null>(null);
  const [fabPosition, setFabPosition] = useState<{ x: number; y: number } | null>(null);
  const [fabDragging, setFabDragging] = useState(false);

  // Restore last position once on mount; clamp it in case the viewport
  // shrank between sessions (e.g. rotation).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(FAB_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        const size = 56; // matches h-14 w-14
        const x = Math.max(
          FAB_MARGIN,
          Math.min(window.innerWidth - size - FAB_MARGIN, parsed.x)
        );
        const y = Math.max(
          FAB_MARGIN,
          Math.min(window.innerHeight - size - FAB_MARGIN, parsed.y)
        );
        setFabPosition({ x, y });
      }
    } catch {
      /* corrupt JSON or quota-blocked storage — fall back to default position */
    }
  }, []);

  // Keep the FAB inside the viewport when the window resizes / rotates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setFabPosition((prev) => {
        if (!prev || !fabButtonRef.current) return prev;
        const rect = fabButtonRef.current.getBoundingClientRect();
        const x = Math.max(
          FAB_MARGIN,
          Math.min(window.innerWidth - rect.width - FAB_MARGIN, prev.x)
        );
        const y = Math.max(
          FAB_MARGIN,
          Math.min(window.innerHeight - rect.height - FAB_MARGIN, prev.y)
        );
        if (x === prev.x && y === prev.y) return prev;
        return { x, y };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleFabPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!fabButtonRef.current) return;
    // Only track primary button / single touch — don't fight context menu
    // long-press on iOS or right-click on desktop.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const rect = fabButtonRef.current.getBoundingClientRect();
    fabDragRef.current = {
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      elementStartX: rect.left,
      elementStartY: rect.top,
      moved: false,
    };
    try {
      fabButtonRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw in rare edge cases — drag still works */
    }
  }, []);

  const handleFabPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const state = fabDragRef.current;
    if (!state || !fabButtonRef.current) return;
    const dx = e.clientX - state.pointerStartX;
    const dy = e.clientY - state.pointerStartY;
    if (!state.moved && Math.hypot(dx, dy) >= FAB_DRAG_THRESHOLD) {
      state.moved = true;
      setFabDragging(true);
    }
    if (!state.moved) return;
    const rect = fabButtonRef.current.getBoundingClientRect();
    const rawX = state.elementStartX + dx;
    const rawY = state.elementStartY + dy;
    const x = Math.max(
      FAB_MARGIN,
      Math.min(window.innerWidth - rect.width - FAB_MARGIN, rawX)
    );
    const y = Math.max(
      FAB_MARGIN,
      Math.min(window.innerHeight - rect.height - FAB_MARGIN, rawY)
    );
    setFabPosition({ x, y });
  }, []);

  const handleFabPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const state = fabDragRef.current;
      fabDragRef.current = null;
      setFabDragging(false);
      try {
        fabButtonRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* may have already been released */
      }
      if (state?.moved) {
        // Drag completed → magnet snap to the nearest vertical edge.
        // FB Messenger / Android accessibility-overlay convention: the
        // FAB sticks to either the left or right side at the Y where
        // the user released it. The Y is preserved (and clamped) so
        // the FAB stays in the thumb zone they chose; only X moves.
        if (fabButtonRef.current) {
          const rect = fabButtonRef.current.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const snappedX =
            centerX < window.innerWidth / 2
              ? FAB_MARGIN
              : window.innerWidth - rect.width - FAB_MARGIN;
          const snappedY = Math.max(
            FAB_MARGIN,
            Math.min(window.innerHeight - rect.height - FAB_MARGIN, rect.top)
          );
          const snapped = { x: snappedX, y: snappedY };
          setFabPosition(snapped);
          try {
            window.localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(snapped));
          } catch {
            /* quota / private mode — magnet still works, just won't persist */
          }
        }
        return; // swallow the click — user was dragging, not tapping
      }
      // No movement → treat as a tap → run the FAB action.
      if (quickFabHref) safeNavigate(quickFabHref);
    },
    // safeNavigate / quickFabHref are stable per render but lint demands them
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quickFabHref]
  );

  useEffect(() => {
    setMobileNavOpen(false);
    setNavigationAnnouncement(`Navigated to ${location.pathname}`);
  }, [location.pathname]);

  const safeNavigate = (path: string | undefined) => {
    if (!path) {
      return;
    }

    if (isPathAllowedForRole(role, path)) {
      navigate(path);
      return;
    }

    navigate(rolePathMap[role], {
      state: { deniedModule: getTabForPath(path) }
    });
  };

  const animatedProps = reduceMotion
    ? {}
    : {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.26, ease: "easeOut" as const }
    };

  return (
    <div className="min-h-screen bg-base text-text">
      <div className="mx-auto flex w-full max-w-[1560px] items-start gap-0">
        {!collapseSidebar && (
          <Sidebar
            role={role}
            userName={userName}
            navItems={navItems}
            themeMode={themeMode}
            onCycleTheme={onCycleTheme}
            onLogout={onLogout}
          />
        )}

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col gap-3 px-3 py-3 dark:bg-panel/14 lg:px-4 lg:py-4 xl:px-5 xl:py-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/14 to-transparent" aria-hidden="true" />
          <Topbar
            themeMode={themeMode}
            onCycleTheme={onCycleTheme}
            onLogout={onLogout}
            onOpenMobileNav={() => setMobileNavOpen((value) => !value)}
            showMobileNavToggle
            mobileNavOpen={mobileNavOpen}
            mobileNavDrawerId={drawerId}
            alwaysVisible={collapseSidebar}
          />

          <motion.main
            {...animatedProps}
            className="relative flex-1 px-1 py-1 lg:px-2 lg:py-1"
          >
            {children}
          </motion.main>
        </div>
      </div>

      {(() => {
        const FabIcon = quickFabAction.icon
          ? FAB_ICON_REGISTRY[quickFabAction.icon] ?? null
          : null
        // When the user has dragged the FAB at least once, switch from
        // the bottom-6/right-6 CSS anchor to absolute pixel coords. Until
        // then, the default corner anchor wins (avoids a flash of
        // mispositioning on first render).
        const dragged = fabPosition !== null
        const inlineStyle: React.CSSProperties = dragged
          ? {
              top: `${fabPosition!.y}px`,
              left: `${fabPosition!.x}px`,
              right: "auto",
              bottom: "auto",
              touchAction: "none" // suppress scroll while dragging on touch
            }
          : { touchAction: "none" }
        return (
          <button
            type="button"
            ref={fabButtonRef}
            onPointerDown={handleFabPointerDown}
            onPointerMove={handleFabPointerMove}
            onPointerUp={handleFabPointerUp}
            onPointerCancel={handleFabPointerUp}
            // Click is handled inside pointerUp (so we can swallow it
            // when the user was dragging). Don't double-fire navigation.
            // Keep keyboard users covered with onKeyDown for Enter/Space.
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && quickFabHref) {
                e.preventDefault()
                safeNavigate(quickFabHref)
              }
            }}
            aria-label={`${quickFabAction.label} (drag to reposition)`}
            title={quickFabAction.label}
            disabled={!quickFabHref}
            style={inlineStyle}
            className={[
              // Position — anchored bottom-right by default; switched
              // to inline-style top/left once the user has dragged.
              dragged ? "fixed z-30 lg:hidden" : "fixed bottom-6 right-6 z-30 lg:hidden",
              // Shape — 56px circle. Material-style floating action btn.
              "inline-flex h-14 w-14 items-center justify-center rounded-full",
              // Color — single solid accent. Restrained.
              "border border-accent/35 bg-accent text-base",
              // Elevation — two-layer shadow for genuine "floating"
              // feel; deepens on hover and while dragging.
              "shadow-[0_2px_6px_-1px_rgb(0_0_0/0.18),0_10px_24px_-6px_rgb(var(--color-accent)/0.45)]",
              // Motion — short ease-out. Disable the lift transition
              // while dragging so the button tracks the pointer 1:1
              // instead of easing behind it.
              fabDragging
                ? "transition-none"
                : "transition-all duration-200 ease-out hover:-translate-y-1 hover:brightness-105 hover:shadow-[0_4px_10px_-2px_rgb(0_0_0/0.22),0_16px_32px_-8px_rgb(var(--color-accent)/0.55)] active:translate-y-0 active:brightness-95",
              // Dragging affordance — slight scale-up + stronger shadow
              // so the user feels they've "picked it up".
              fabDragging
                ? "scale-110 cursor-grabbing shadow-[0_6px_14px_-2px_rgb(0_0_0/0.28),0_22px_40px_-10px_rgb(var(--color-accent)/0.6)]"
                : "cursor-grab",
              // Suppress browser text/icon selection during drag.
              "select-none",
              // Focus ring stays even while dragging.
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-base",
              // Disabled — fade, no motion.
              "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:brightness-100"
            ].join(" ")}
          >
            {FabIcon ? (
              <FabIcon className="h-6 w-6" aria-hidden="true" />
            ) : (
              <span className="text-xs font-semibold">{quickFabAction.label.slice(0, 2).toUpperCase()}</span>
            )}
            <span className="sr-only">{quickFabAction.label}</span>
          </button>
        )
      })()}

      <MobileNavDrawer
        isOpen={mobileNavOpen}
        drawerId={drawerId}
        role={role}
        userName={userName}
        navItems={navItems}
        onClose={() => setMobileNavOpen(false)}
        alwaysVisible={collapseSidebar}
      />

      <p className="sr-only" aria-live="polite">
        {navigationAnnouncement}
      </p>
    </div>
  );
};
