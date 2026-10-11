/**
 * Public API of the polywood module. Other code imports polywood only from
 * here (`@/modules/polywood`), never from its components/, lib/ or actions/.
 *
 * No other module uses polywood. The metric/cut-sheet product engine that sales,
 * purchases, products, initial balance and production use (src/lib/polywood) stays
 * in core; this module owns the Polywood stock import screen.
 */
export {};
