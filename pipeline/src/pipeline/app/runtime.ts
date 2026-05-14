export type AppRouterMode = "browser" | "hash";
export type AppBuildTarget = "web" | "native";

const rawBaseUrl = import.meta.env.BASE_URL ?? "/";

const normalizeBasePath = (value: string): string => {
  if (!value || value === "/" || !value.startsWith("/")) {
    return "";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

export const appBuildTarget: AppBuildTarget = import.meta.env.VITE_APP_BUILD_TARGET === "native" ? "native" : "web";
export const appRouterMode: AppRouterMode = import.meta.env.VITE_ROUTER_MODE === "hash" ? "hash" : "browser";
export const appBasePath = normalizeBasePath(rawBaseUrl);
export const routerBasename = appBasePath || undefined;

export const buildAppPath = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (appRouterMode === "hash") {
    const hashPrefix = appBasePath ? `${appBasePath}/#` : "/#";
    return `${hashPrefix}${normalizedPath}`;
  }

  return appBasePath ? `${appBasePath}${normalizedPath}` : normalizedPath;
};

export const buildAbsoluteAppUrl = (path: string): string => {
  if (typeof window === "undefined") {
    return buildAppPath(path);
  }

  return new URL(buildAppPath(path), `${window.location.origin}/`).toString();
};

export const resolveHostedUrl = (value: string): string => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  if (typeof window === "undefined") {
    return value;
  }

  const baseReference = rawBaseUrl.startsWith("/")
    ? new URL(rawBaseUrl, `${window.location.origin}/`)
    : new URL(rawBaseUrl, window.location.href);

  return new URL(value, baseReference).toString();
};
