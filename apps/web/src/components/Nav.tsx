"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getEmail, getAccessToken } from "@/lib/api";

export default function Nav() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setEmail(getAccessToken() ? getEmail() : null);
  }, []);

  const logout = async () => {
    clearSession();
    setEmail(null);
    router.push("/login");
  };

  return (
    <nav className="nav">
      {mounted && email ? (
        <>
          <Link href="/reminders" className="nav-link">
            Reminders
          </Link>
          <span className="nav-user" title={email}>
            {email}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Log out
          </button>
        </>
      ) : (
        <>
          <Link href="/login" className="nav-link">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary btn-sm">
            Sign up
          </Link>
        </>
      )}
    </nav>
  );
}
