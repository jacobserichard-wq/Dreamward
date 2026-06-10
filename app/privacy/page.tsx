import fs from "fs";
import path from "path";
import PolicyDocument from "../components/PolicyDocument";

export const metadata = {
  title: "Privacy Policy — Dreamward",
  description: "How Dreamward collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), "privacy.md"),
    "utf8"
  );
  return <PolicyDocument content={content} />;
}
