import AdminConsole from "../components/AdminConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理者ワークスペース | SpareLink", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminConsole />;
}
