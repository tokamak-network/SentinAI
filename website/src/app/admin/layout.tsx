import AdminSidebar from '@/components/AdminSidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex bg-black text-white min-h-screen">
      <AdminSidebar />
      <div className="flex-1 flex flex-col p-8 bg-black overflow-auto">
        {children}
      </div>
    </div>
  );
}
