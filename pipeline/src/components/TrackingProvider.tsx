import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../lib/tracking";

/**
 * Initializes tracking and fires PageView on route changes.
 * FB Pixel and GTM scripts are loaded in index.html.
 */
const TrackingProvider = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  return <>{children}</>;
};

export default TrackingProvider;
