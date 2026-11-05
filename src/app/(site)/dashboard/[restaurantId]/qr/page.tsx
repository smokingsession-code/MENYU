import { redirect } from "next/navigation";

// QR codes now live with the tables they belong to.
export default async function QrPage({ params }: PageProps<"/dashboard/[restaurantId]/qr">) {
  const { restaurantId } = await params;
  redirect(`/dashboard/${restaurantId}/tables`);
}
