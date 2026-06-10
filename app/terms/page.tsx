import fs from "fs";
import path from "path";
import PolicyDocument from "../components/PolicyDocument";

export const metadata = {
  title: "Terms of Service — Dreamward",
  description: "Terms governing use of Dreamward at godreamward.com.",
};

export default function TermsPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), "terms.md"),
    "utf8"
  );
  return <PolicyDocument content={content} />;
}
