// Optional owner-run recovery helper. Paste only into the isolated staging editor.
// Do not deploy this helper or include it in production builds.
function resetNhStagingPassword() {
  stagingProjectGuard_();
  stagingSheet_();
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('STAGING_TEST_USER');
  const password = props.getProperty('STAGING_TEST_PASSWORD');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/.test(user || '') || !password || password.length < 16 || password.length > 256) {
    throw new Error('SET_STAGING_USER_AND_16_CHARACTER_PASSWORD');
  }
  const hash = securityNewPassword_(password);
  securityWithLock_(function () {
    const found = securityFindUser_(user);
    if (!found || String(found.row[2]) !== 'approved' || String(found.row[3]) !== 'true') {
      throw new Error('STAGING_APPROVED_ADMIN_NOT_FOUND');
    }
    found.sheet.getRange(found.index, 2).setValue(hash);
    const all = props.getProperties();
    Object.keys(all).filter(key => key.startsWith('S_')).forEach(function (key) {
      try { if (JSON.parse(all[key]).u === user) props.deleteProperty(key); } catch (error) {}
    });
    CacheService.getScriptCache().remove(securityRateKey_(user));
    props.deleteProperty('STAGING_TEST_PASSWORD');
  });
  Logger.log('STAGING_PASSWORD_RESET_OK');
}
