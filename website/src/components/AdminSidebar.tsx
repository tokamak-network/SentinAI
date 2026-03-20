import Link from 'next/link';

export default function AdminSidebar() {
  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 h-screen flex flex-col p-4 font-mono text-sm">
      <div className="text-xl font-bold mb-8 text-green-400">SentinAI Admin</div>
      
      <nav className="flex flex-col space-y-2">
        <Link 
          href="/admin/transactions" 
          className="px-4 py-2 rounded hover:bg-gray-800 transition-colors text-gray-300 hover:text-white"
        >
          Transactions
        </Link>
        <Link 
          href="/admin/analytics" 
          className="px-4 py-2 rounded hover:bg-gray-800 transition-colors text-gray-300 hover:text-white"
        >
          Analytics
        </Link>
      </nav>
      
      <div className="mt-auto text-xs text-gray-500">
        SentinAI Admin v1.0
      </div>
    </div>
  );
}
