(function () {
  function pushListingDraft(payload) {
    return Promise.resolve({
      ok: true,
      type: 'pushListingDraft',
      payload: payload || {},
      storedAt: new Date().toISOString(),
    });
  }

  window.OZON_CALC_ERP_PUSH_LISTING_DRAFT = {
    pushListingDraft: pushListingDraft,
  };
}());
