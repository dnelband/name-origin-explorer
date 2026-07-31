import { redirect } from "next/navigation";

type NameRedirectProps = {
  params: Promise<{ id: string }>;
};

export default async function NameRedirect({ params }: NameRedirectProps) {
  const { id } = await params;
  redirect(`/?name=${id}`);
}
