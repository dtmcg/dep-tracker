import { createContext, useContext } from "react";

/** Features that are switched on when the backend starts (see --resourcing). */
export interface Features {
  resourcing: boolean;
  /** The online demo: the project lives in memory, so there is nothing to export or close. */
  demo?: boolean;
}

export const FeaturesContext = createContext<Features>({ resourcing: false });
export const useFeatures = () => useContext(FeaturesContext);
