import { DB } from "../util/db";

/**
 * Shared runtime configuration and the single database handle.
 * Kept in its own module so bot/helper modules never have to import the
 * application entry point (which would create an import cycle).
 */
export const WHICH_PANEL = "fi";
export const WHICH_INBOUND = "8";

export const db = new DB();
