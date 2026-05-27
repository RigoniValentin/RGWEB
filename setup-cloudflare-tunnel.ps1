"use client";

import type { CSSProperties, MouseEvent } from "react";
import { ArrowUpRight, FileText, Flag, Globe2, Landmark, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/navigation";

type ServiceCard = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  cta: string;
};

const serviceIcons = {
  argentina: Landmark,
  italian: Flag,
  usa: Globe2,
  legal: Scale,
  global: FileText,
} as const;

const spotlightStyle = {
  "--spotlight-x": "50%",
  "--spotlight-y": "35%",
} as CSSProperties;

export function Products() {
  const t = useTranslations("stepper");
  const services = t.raw("services") as ServiceCard[];

  function handlePointerMove(event: MouseEvent<HTMLAnchorElement>) {
    const cardBounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--spotlight-x",
      `${event.clientX - cardBounds.left}px`,
    );
    event.currentTarget.style.setProperty(
      "--spotlight-y",
      `${event.clientY - cardBounds.top}px`,
    );
  }

  return (
    <section
      id="process"
      // AJUSTE 1: Reducimos el padding vertical general (py-16 a py-10, y lg:py-8 a lg:py-6)
      // Cambiamos min-h-[calc(100svh-5rem)] a un control más estricto de h-screen o max-h-screen para forzar que entre.
      className="relative isolate overflow-hidden bg-primary-900 py-10 text-white lg:flex lg:h-[calc(100svh-5rem)] lg:items-center lg:scroll-mt-20 lg:py-6"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_18%_8%,rgba(169,122,81,0.22),transparent_42%),radial-gradient(760px_circle_at_92%_78%,rgba(35,51,73,0.85),transparent_45%),linear-gradient(180deg,#0f172a_0%,#111a25_48%,#0b1220_100%)]" />
      <div className="hero-grain pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-screen" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

      {/* AJUSTE 2: Añadimos un max-height al contenedor principal y permitimos flex-col para manejar el espacio interno */}
      <div className="container relative z-10 flex h-full max-h-[900px] flex-col justify-center">
        
        {/* Cabecera de la sección (Títulos) - Reducimos márgenes y gaps */}
        <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr] lg:items-end xl:gap-8 mb-6 lg:mb-8">
          <div>
            <span className="inline-flex items-center gap-3 text-eyebrow uppercase text-accent-300">
              <span className="h-px w-10 bg-accent/70" />
              {t("eyebrow")}
            </span>
            {/* Título más compacto */}
            <h2 className="mt-3 max-w-xl font-display text-2xl md:text-3xl lg:text-4xl text-white">
              {t("title")}
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-white/68 lg:justify-self-end lg:text-base">
            {t("subtitle")}
          </p>
        </div>

        {/* Grid de Tarjetas - Reducimos el auto-rows y los gaps para que sean más compactas */}
        <div className="grid auto-rows-[minmax(180px,auto)] gap-3 md:grid-cols-2 xl:grid-cols-4 xl:gap-4 flex-1">
          {services.map((service) => {
            const Icon = serviceIcons[service.id as keyof typeof serviceIcons] ?? FileText;
            const isFeatured = service.id === "argentina";

            return (
              <Link
                key={service.id}
                href="/#contact"
                aria-label={`${t("selectLabel")} ${service.title}`}
                onMouseMove={handlePointerMove}
                style={spotlightStyle}
                className={[
                  // AJUSTE 3: Reducimos p-5 a p-4 (mobile) y lg:p-6 a lg:p-5 (desktop). Bajamos min-h.
                  "group relative isolate flex min-h-[180px] overflow-hidden rounded-card border p-4 outline-none transition-all duration-500 ease-out before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(360px_circle_at_var(--spotlight-x)_var(--spotlight-y),rgba(222,178,95,0.24),transparent_46%)] before:opacity-0 before:transition-opacity before:duration-500 hover:-translate-y-1 hover:before:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/70 lg:p-5",
                  isFeatured
                    // AJUSTE 4: Tarjeta destacada más baja (min-h-[240px] en vez de 320px)
                    ? "md:col-span-2 xl:col-span-2 min-h-[220px] border-accent/55 bg-white/[0.075] shadow-[0_0_0_1px_rgba(222,178,95,0.18),0_32px_90px_-38px_rgba(222,178,95,0.75)] lg:min-h-[240px]"
                    : "border-white/10 bg-white/[0.045] shadow-[0_24px_70px_-48px_rgba(0,0,0,0.9)]",
                ].join(" ")}
              >
                <div className="absolute inset-0 -z-20 bg-gradient-to-br from-white/[0.11] via-white/[0.025] to-transparent opacity-80" />
                <div
                  className={[
                    "absolute right-4 top-4 -z-10 rounded-full bg-accent/10 blur-2xl transition-all duration-700 group-hover:scale-125 group-hover:bg-accent/20",
                    isFeatured ? "h-32 w-32" : "h-20 w-20",
                  ].join(" ")}
                />

                {/* Ajustamos los gaps internos de las tarjetas */}
                <div className="flex h-full w-full flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="rounded-pill border border-accent/25 bg-accent/10 px-2 py-1 text-[9px] font-medium uppercase tracking-wider2 text-accent-300">
                        {service.eyebrow}
                      </span>
                      <span
                        className={[
                          "grid shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-accent-300 transition-transform duration-500 group-hover:scale-110",
                          isFeatured ? "h-10 w-10" : "h-8 w-8",
                        ].join(" ")}
                        aria-hidden
                      >
                        <Icon className={isFeatured ? "h-5 w-5" : "h-4 w-4"} />
                      </span>
                    </div>

                    <h3
                      className={[
                        // Títulos de tarjeta más pequeños
                        "mt-4 font-display leading-tight text-white lg:mt-5",
                        isFeatured ? "max-w-xl text-2xl lg:text-3xl" : "text-lg lg:text-xl",
                      ].join(" ")}
                    >
                      {service.title}
                    </h3>
                    <p
                      className={[
                        // Textos de resumen más compactos y con menos interlineado
                        "mt-2 leading-snug text-white/64 lg:mt-3",
                        isFeatured ? "max-w-xl text-sm sm:text-base" : "text-xs",
                      ].join(" ")}
                    >
                      {service.summary}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 mt-2">
                    {/* Ocultamos el 'detail' (la info técnica extra) en pantallas chicas/medianas si no es la destacada para ahorrar espacio */}
                    <p className={["max-w-[60%] text-[10px] uppercase tracking-wider2 text-white/38", !isFeatured && "hidden xl:block"].join(" ")}>
                      {service.detail}
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-300 transition-colors group-hover:text-accent-200">
                      {service.cta}
                      <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}