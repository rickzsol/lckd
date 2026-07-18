import { permanentRedirect } from "next/navigation";

export default function TrustRedirect() {
  permanentRedirect("/docs#trust");
}
