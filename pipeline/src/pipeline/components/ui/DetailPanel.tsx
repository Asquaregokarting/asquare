import { ReactNode } from "react";

export const DetailPanel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="ui-panel p-4 lg:p-5">
    <h3 className="font-display text-xl leading-tight tracking-tight text-text lg:text-2xl">{title}</h3>
    <div className="mt-4">{children}</div>
  </section>
);
