import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Link href="/">
            <Logo className="h-16 w-auto" priority />
          </Link>
          <p className="text-sm text-muted">Recognition, delivered</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
