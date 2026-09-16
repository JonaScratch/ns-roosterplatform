/**
 * Vervanger voor het pakket `server-only` tijdens tests.
 *
 * Dat pakket gooit zodra het buiten een servercomponent wordt geladen. Dat is
 * precies de bedoeling in de applicatie: het voorkomt dat servercode per
 * ongeluk in de browserbundel belandt. Vitest draait echter in Node, buiten de
 * bundelaar om, en heeft die grens niet.
 *
 * Deze stub houdt de bescherming in de applicatie intact en maakt de servercode
 * tegelijk toetsbaar. Hij is uitsluitend gekoppeld in vitest.config.mts.
 */
export {};
