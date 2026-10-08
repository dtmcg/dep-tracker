import { createContext, useContext } from "react";

/** Features that are switched on when the backend starts (see --resourcing). */
export interface Features {
  resourcing: boolean;
}

export const FeaturesContext = createContext<Features>({ resourcing: false });
export const useFeatures = () => useContext(FeaturesContext);
