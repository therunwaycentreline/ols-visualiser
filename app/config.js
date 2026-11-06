// Esri ArcGIS Location Platform API key (public by design). Restricted to the site's
// referrers, basemaps privilege only, pay-as-you-go off. Expires about Nov 2027:
// regenerate from the credential item in the Location Platform portal before then.
export const ESRI_KEY = 'AAPTaFXTCMi993Q1_l299oaqGEA..tgjnuZBaHwebrqfxMh533lw69CqFI8cRSgB5Wgkb7ZIkl7WT5i8aPHsxO9ahEyEEStVIgrJ1xPmymG9xXRKp52mJ1w5GYx9Juy5_7LDNTcQ_yjJWsd2hHYv6iINadI_E9qpnzQi98nqH3xiHZfNKp8jyUdW03SEuri8KqSpHz47zpY5pjNfYEFwMQrwHUnkSl6l1OOn6udGKdsY02guT3hZ9vlJGaWEEMTdk68vFzed_Xep8E-eqAT1_d3IRISgL';
// Tile URL as given by Esri's arcgis/imagery basemap style (Basemap Styles service v2).
export const ESRI_IMAGERY_TILES = `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ESRI_KEY}`;
export const ESRI_IMAGERY_ATTRIBUTION = 'Powered by Esri. Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community';
