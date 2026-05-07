import { useEffect, useState } from "react";
import { ThemeToggle } from "./components/ThemeToggle";
import { CurateScreen } from "./screens/CurateScreen";
import { PhoneCaptureScreen } from "./screens/PhoneCaptureScreen";

export default function App() {
  const [redirecting, setRedirecting] = useState(false);
  const isPhoneRoute =
    /^\/phone\/?$/.test(window.location.pathname) ||
    /^\/phone\/[^/]+\/?$/.test(window.location.pathname);
  const publicOrigin = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim();
  const redirectLocalToPublic =
    import.meta.env.VITE_REDIRECT_LOCAL_TO_PUBLIC === "true";

  useEffect(() => {
    const isRootPath = window.location.pathname === "/";
    const forceDesktop = new URLSearchParams(window.location.search).get("desktop") === "1";
    const looksLikeMobile = /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);

    if (!isPhoneRoute && isRootPath && looksLikeMobile && !forceDesktop) {
      setRedirecting(true);
      window.location.replace("/phone");
      return;
    }
  }, [isPhoneRoute]);

  useEffect(() => {
    const isLocalHost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const bypassLocalRedirect = new URLSearchParams(window.location.search).get("local") === "1";

    if (!publicOrigin || !redirectLocalToPublic || !isLocalHost || bypassLocalRedirect) {
      return;
    }

    try {
      const nextUrl = new URL(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        publicOrigin,
      );

      if (nextUrl.origin === window.location.origin) {
        return;
      }

      setRedirecting(true);
      window.location.replace(nextUrl.toString());
    } catch (error) {
      console.error(error);
    }
  }, [publicOrigin, redirectLocalToPublic]);

  if (redirecting) {
    return null;
  }

  if (isPhoneRoute) {
    return (
      <>
        <PhoneCaptureScreen />
        <ThemeToggle />
      </>
    );
  }

  return <CurateScreen />;
}
