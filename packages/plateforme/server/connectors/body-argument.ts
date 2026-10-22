// Le corps entier d'une fonction décrite (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits ; `connectors :
// docs/conception/format-de-description.md` § Le corps entier) : `request.body` nomme un argument, un objet strict et
// requis du schéma (fermé, ou à clés libres en texte toutes donnée personnelle), que le moteur envoie tel que validé, en
// JSON, au lieu d'une table nom côté API → argument ; et sa
// déclaration contrôlée comme la règle 20 de la fabrique, avec ses codes. Sans ce module, un client qui envoie un objet
// entier (un contact, les réglages d'une campagne) ne se décrirait qu'en recopiant chaque clé en argument.
import { isJsonObject } from "../json"
import type { ConnectorArgumentMap, ConnectorFunctionDefinition, ConnectorRequest } from "./definition"

/** Les méthodes qui n'envoient pas de corps (`fetch` refuse un corps en `GET`). */
const NO_BODY_METHODS = ["GET"]

/** L'argument qui forme le corps entier, ou `null` pour un corps en table. */
export function bodyArgument(spec: ConnectorRequest): string | null {
  return typeof spec.body === "string" ? spec.body : null
}

/** La table du corps, nom côté API → argument ; vide quand le corps est un argument entier, qui n'a pas de nom côté API. */
export function bodyTable(spec: ConnectorRequest): ConnectorArgumentMap {
  return typeof spec.body === "string" ? {} : spec.body
}

/**
 * Des clés libres en texte, toutes donnée personnelle (décidé par Alexis le 2026-10-22), à la racine de l'argument
 * seulement : `additionalProperties` vaut exactement `{ type: "string", personal: true }`. Chaque clé que `properties`
 * ne déclare pas est un texte, qu'Ajv contrôle avant tout envoi et que le journal ne garde pas (`catalog/personal.ts`).
 * Ni `true`, ni un autre type, ni un schéma sans `personal`, ni un mot de plus.
 */
function freeTextKeys(additional: unknown): boolean {
  return isJsonObject(additional) && Object.keys(additional).length === 2 && additional.type === "string" && additional.personal === true
}

/**
 * Un objet strict : `type: object`, `additionalProperties: false` ou des clés libres en texte (`freeTextKeys`), au moins
 * une propriété déclarée, aucune clé admise par motif (`patternProperties` rouvrirait l'objet). Les propriétés
 * elles-mêmes sont libres de leur forme.
 */
function strictObject(schema: unknown): boolean {
  return (
    isJsonObject(schema) &&
    schema.type === "object" &&
    (schema.additionalProperties === false || freeTextKeys(schema.additionalProperties)) &&
    isJsonObject(schema.properties) &&
    Object.keys(schema.properties).length > 0 &&
    !Object.hasOwn(schema, "patternProperties")
  )
}

/**
 * Le problème d'un corps formé par un argument entier, comme la règle 20 de la fabrique et dans son ordre, le message
 * finissant par son code ; `null` : aucun, ou un corps en table. L'argument est déclaré, un objet strict, requis ; la
 * méthode envoie un corps ; il ne va nulle part ailleurs (chemin, query, en-tête, partie fichier), n'est pas encodé ;
 * aucune constante de corps ni partie fichier ne le rejoint ; la fonction n'est pas paginée.
 */
export function bodyArgumentProblem(fn: ConnectorFunctionDefinition): string | null {
  const spec = fn.request
  const argument = bodyArgument(spec)
  if (argument === null) return null
  const at = `${fn.name}: request.body ${argument}`
  const properties = isJsonObject(fn.schema.properties) ? fn.schema.properties : {}
  if (!Object.hasOwn(properties, argument)) return `${at} is not an argument of the schema (body_argument_unknown).`
  if (!strictObject(properties[argument])) {
    return `${at} must be a strict object: type object, additionalProperties false or free text keys { type: "string", personal: true }, at least one declared property, no patternProperties (body_argument_not_strict).`
  }
  const required = Array.isArray(fn.schema.required) ? fn.schema.required : []
  if (!required.includes(argument)) return `${at} must be required: the whole body is never absent (body_argument_optional).`
  if (NO_BODY_METHODS.includes(spec.method)) return `${at} needs a method that sends a body, not ${spec.method} (body_argument_method).`
  const inPath = [...spec.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
  const elsewhere = [...inPath, ...Object.values(spec.query), ...Object.values(spec.headers), ...Object.values(spec.files ?? {})]
  if (elsewhere.includes(argument)) return `${at} is the whole body: it goes nowhere else, path, query, headers or files (body_argument_elsewhere).`
  if (spec.encode?.[argument] !== undefined) return `${at} is sent as the object it is, never encoded (body_argument_encoded).`
  if (spec.constants?.body !== undefined || spec.files !== undefined) {
    return `${at} is the whole body: no body constant nor file part joins it (body_argument_not_alone).`
  }
  if (fn.pagination !== undefined) return `${at}: a function whose body is one argument is not paginated (body_argument_paginated).`
  return null
}
