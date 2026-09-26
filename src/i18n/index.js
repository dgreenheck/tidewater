import { loadLocale, SUPPORTED_LOCALES } from './locales/index.js';

export { SUPPORTED_LOCALES };

let locale = 'en';
let catalog = { messages: {}, plurals: {} };
let englishCatalog = catalog;
const numberFormatters = new Map();
const dateFormatters = new Map();

function normalizeLocale( value ) {
	if ( ! value ) return null;

	const parts = String( value ).replaceAll( '_', '-' ).split( '-' );
	const language = parts[ 0 ].toLowerCase();
	const region = parts.find( ( part ) => part.length === 2 && /^[a-z]{2}$/i.test( part ) )?.toUpperCase();
	const script = parts.find( ( part ) => part.length === 4 && /^[a-z]{4}$/i.test( part ) )?.toLowerCase();

	if ( language === 'zh' ) {
		if ( script === 'hant' || [ 'TW', 'HK', 'MO' ].includes( region ) ) return 'zh-TW';
		return 'zh-CN';
	}

	return SUPPORTED_LOCALES.includes( language ) ? language : null;
}

export function resolveLocale( languages = globalThis.navigator?.languages || [ globalThis.navigator?.language ] ) {
	for ( const language of languages || [] ) {
		const resolved = normalizeLocale( language );
		if ( resolved ) return resolved;
	}

	return 'en';
}

export async function initI18n() {
	const override = new URLSearchParams( globalThis.location?.search || '' ).get( 'lang' );
	locale = override ? ( normalizeLocale( override ) || 'en' ) : resolveLocale();
	try {
		catalog = await loadLocale( locale );
	} catch ( error ) {
		if ( locale === 'en' ) throw error;
		console.warn( `Could not load the ${ locale } locale; falling back to English.`, error );
		locale = 'en';
		catalog = await loadLocale( locale );
	}
	englishCatalog = locale === 'en' ? catalog : await loadLocale( 'en' );
	if ( globalThis.document?.documentElement ) {
		document.documentElement.lang = locale;
		if ( document.title ) document.title = t( document.title );
		if ( document.body ) localizeDOM( document.body );
	}
	return locale;
}

export const getLocale = () => locale;

function interpolate( message, values ) {
	return String( message ).replace( /\{([\w.-]+)\}/g, ( token, name ) => {
		const value = values[ name ];
		return value === undefined || value === null ? token : String( value );
	} );
}

export function t( source, values = {} ) {
	const message = locale === 'en' ? source : ( catalog.messages?.[ source ] ?? source );
	return interpolate( message, values );
}

export function tn( key, count, values = {} ) {
	const pluralCategory = new Intl.PluralRules( locale ).select( count );
	const localized = catalog.plurals?.[ key ];
	const english = englishCatalog.plurals?.[ key ];
	const message = localized?.[ pluralCategory ] || localized?.other || english?.[ pluralCategory ] || english?.other || key;
	return interpolate( message, { ...values, count } );
}

export function formatNumber( value, options = {} ) {
	const key = JSON.stringify( [ locale, options ] );
	let formatter = numberFormatters.get( key );
	if ( ! formatter ) {
		formatter = new Intl.NumberFormat( locale, options );
		numberFormatters.set( key, formatter );
	}
	return formatter.format( value );
}

export function formatCurrency( value, currency = 'USD' ) {
	return formatNumber( value, { style: 'currency', currency, maximumFractionDigits: 0 } );
}

export function formatDate( value, options = { dateStyle: 'medium' } ) {
	const key = JSON.stringify( [ locale, options ] );
	let formatter = dateFormatters.get( key );
	if ( ! formatter ) {
		formatter = new Intl.DateTimeFormat( locale, options );
		dateFormatters.set( key, formatter );
	}
	return formatter.format( value );
}

const translatableAttributes = [ 'aria-label', 'title', 'placeholder', 'alt', 'data-tip', 'data-tip-hint' ];
const messageElements = 'p, h1, h2, h3, h4, button, label, option, legend, summary, .loader-kicker, .loader-title, .loader-tagline, .loader-status, .loader-note, .loader-tip, .loader-tip-label';

function localizeMessageElement( element ) {
	if ( element.childElementCount && element.tagName !== 'P' ) return;
	const original = element.textContent;
	const leading = original.match( /^\s*/ )?.[ 0 ] || '';
	const trailing = original.match( /\s*$/ )?.[ 0 ] || '';
	const end = Math.max( leading.length, original.length - trailing.length );
	const message = original.slice( leading.length, end );
	if ( ! message ) return;
	const translated = t( message );
	if ( translated !== message ) {
		const keycaps = [ ...element.querySelectorAll( 'kbd' ) ];
		if ( keycaps.length ) {
			let html = `${ leading }${ translated }${ trailing }`.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
			let cursor = 0;
			for ( const keycap of keycaps ) {
				const key = keycap.textContent.trim().replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
				const position = html.indexOf( key, cursor );
				if ( position >= 0 ) {
					html = html.slice( 0, position ) + keycap.outerHTML + html.slice( position + key.length );
					cursor = position + keycap.outerHTML.length;
				}
			}
			element.innerHTML = html;
		} else element.textContent = leading + translated + trailing;
	}
}

export function localizeDOM( root ) {
	if ( ! root || locale === 'en' ) return root;
	const elements = root.nodeType === 1 ? [ root, ...root.querySelectorAll( '*' ) ] : [ ...root.querySelectorAll( '*' ) ];
	for ( const element of elements ) {
		for ( const attribute of translatableAttributes ) {
			const value = element.getAttribute( attribute );
			if ( value ) element.setAttribute( attribute, t( value ) );
		}
	}
	for ( const element of root.querySelectorAll( messageElements ) ) localizeMessageElement( element );
	for ( const element of root.querySelectorAll( '*' ) ) if ( element.children.length === 0 ) localizeMessageElement( element );
	const walker = document.createTreeWalker( root, NodeFilter.SHOW_TEXT );
	while ( walker.nextNode() ) {
		const node = walker.currentNode;
		const leading = node.textContent.match( /^\s*/ )?.[ 0 ] || '';
		const trailing = node.textContent.match( /\s*$/ )?.[ 0 ] || '';
		const end = Math.max( leading.length, node.textContent.length - trailing.length );
		const message = node.textContent.slice( leading.length, end );
		if ( message ) node.textContent = leading + t( message ) + trailing;
	}
	return root;
}

export function translateHTML( html ) {
	if ( locale === 'en' || typeof document === 'undefined' ) return html;
	const template = document.createElement( 'template' );
	template.innerHTML = String( html ?? '' );
	localizeDOM( template.content );
	return template.innerHTML;
}
