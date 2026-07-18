export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight">Kudos Cards</p>
          <p className="text-sm text-muted">Recognition, delivered</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
