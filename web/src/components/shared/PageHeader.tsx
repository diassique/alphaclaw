import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  description?: string;
  right?: ReactNode;
}

export function PageHeader({ children, description, right }: Props) {
  return (
    <div className="page-header" style={right ? { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" } : undefined}>
      <div>
        <h1>{children}</h1>
        {description && <p>{description}</p>}
      </div>
      {right}
    </div>
  );
}
