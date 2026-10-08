import { createContext, useContext } from "react";
import { formatMoment } from "./format.ts";

/** Whether dates show their hours and minutes; set from the chart toolbar and read wherever a date is drawn. */
export const ShowTimesContext = createContext(false);

/** Formats a date for display according to the "Show times" setting. */
export function useDateFormatter(): (iso: string, options?: { weekday?: boolean }) => string {
  const time = useContext(ShowTimesContext);
  return (iso, options) => formatMoment(iso, { time, weekday: options?.weekday });
}
