import fs from "fs";
import path from "path";
import PolicyDocument from "../components/PolicyDocument";

export const metadata = {
  title: "Terms of Service — FlowWork",
  description: "Terms governing use of FlowWork at flowworks.it.com.",
};

export default function TermsPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), "terms.md"),
    "utf8"
  );
  return <PolicyDocument content={content} />;
}
