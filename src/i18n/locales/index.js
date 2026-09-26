const localeLoaders = Object.freeze( {
	en: () => import( './en.js' ),
	'zh-CN': () => import( './zh-CN.js' ),
	'zh-TW': () => import( './zh-TW.js' ),
	ja: () => import( './ja.js' ),
	es: () => import( './es.js' ),
	ru: () => import( './ru.js' ),
	de: () => import( './de.js' ),
	fr: () => import( './fr.js' ),
} );

export const SUPPORTED_LOCALES = Object.freeze( Object.keys( localeLoaders ) );

export async function loadLocale( locale ) {
	const loader = localeLoaders[ locale ];
	if ( ! loader ) throw new RangeError( `Unsupported locale: ${ locale }` );
	return ( await loader() ).default;
}
