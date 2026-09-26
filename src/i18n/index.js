import { en } from './locales/en.js';
import { ptBR } from './locales/pt-BR.js';

const STORAGE_KEY = 'comuisland.lang';

export const LOCALES = {
	'pt-BR': ptBR,
	'en': en,
};

export const AVAILABLE_LOCALES = [
	{ id: 'pt-BR', label: 'Português (Brasil)' },
	{ id: 'en', label: 'English' },
];

function detectInitialLocale() {

	try {

		if ( typeof localStorage !== 'undefined' ) {

			const saved = localStorage.getItem( STORAGE_KEY );
			if ( saved && LOCALES[ saved ] ) return saved;

		}

	} catch { /* ignore */ }

	// Default to pt-BR as requested, or check navigator
	try {

		if ( typeof navigator !== 'undefined' && navigator.language ) {

			if ( navigator.language.toLowerCase().startsWith( 'en' ) ) {

				return 'en';

			}

		}

	} catch { /* ignore */ }

	return 'pt-BR';

}

let currentLocale = detectInitialLocale();
const listeners = new Set();

export function getLocale() {

	return currentLocale;

}

export function setLocale( loc ) {

	if ( ! LOCALES[ loc ] || loc === currentLocale ) return;
	currentLocale = loc;
	try {

		if ( typeof localStorage !== 'undefined' ) {

			localStorage.setItem( STORAGE_KEY, loc );

		}

	} catch { /* ignore */ }

	for ( const fn of listeners ) {

		try {

			fn( currentLocale );

		} catch ( err ) {

			console.error( '[i18n] listener error:', err );

		}

	}

}

export function onLocaleChange( fn ) {

	listeners.add( fn );
	return () => listeners.delete( fn );

}

function getProp( obj, path ) {

	if ( ! obj || ! path ) return undefined;
	const parts = path.split( '.' );
	let curr = obj;
	for ( const part of parts ) {

		if ( curr === undefined || curr === null ) return undefined;
		curr = curr[ part ];

	}

	return curr;

}

export function t( path, vars = {} ) {

	const active = LOCALES[ currentLocale ];
	let val = getProp( active, path );
	if ( val === undefined ) {

		val = getProp( LOCALES.en, path );

	}

	if ( val === undefined ) {

		return path;

	}

	if ( typeof val !== 'string' ) {

		return val;

	}

	if ( vars && Object.keys( vars ).length > 0 ) {

		return val.replace( /\{(\w+)\}/g, ( match, key ) => {

			return vars[ key ] !== undefined ? vars[ key ] : match;

		} );

	}

	return val;

}
