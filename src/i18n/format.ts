// Presentation only: stored timestamps, scores and timer calculations stay unchanged.
export function presentation(locale: string) {
  const displayLocale = locale === "en" ? "en-US" : "it-IT";
  const number = new Intl.NumberFormat(displayLocale);
  const percent = new Intl.NumberFormat(displayLocale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const decimal = new Intl.NumberFormat(displayLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const unit = (value: number, name: "hour" | "minute" | "second") => new Intl.NumberFormat(displayLocale, { style: "unit", unit: name, unitDisplay: "short" }).format(value);
  return {
    number: (value: number) => number.format(value),
    decimal: (value: number) => decimal.format(value),
    percent: (value: number) => percent.format(value / 100),
    date: (value: string) => new Intl.DateTimeFormat(displayLocale).format(new Date(value)),
    dateTime: (value: string) => new Intl.DateTimeFormat(displayLocale, { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)),
    duration: (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remaining = seconds % 60;
      return hours ? [unit(hours, "hour"), unit(minutes, "minute")].join(" ") : [unit(minutes, "minute"), unit(remaining, "second")].join(" ");
    },
  };
}
