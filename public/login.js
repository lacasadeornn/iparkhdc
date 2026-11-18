(function () {
  var MESSAGES = {
    not_allowed: '이 Google 계정은 사용 허가 목록에 없습니다. 관리자에게 등록을 요청하세요.',
    client_id_missing: '서버 설정이 끝나지 않았습니다: GOOGLE_CLIENT_ID 환경변수가 없습니다.',
    session_secret_missing: '서버 설정이 끝나지 않았습니다: SESSION_SECRET 비밀값이 없습니다.',
    bad_state: '로그인 요청이 만료되었거나 다른 창에서 시작되었습니다. 다시 시도하세요.',
    bad_nonce: '로그인 요청이 만료되었습니다. 다시 시도하세요.',
    expired: 'Google 토큰이 만료되었습니다. 다시 시도하세요.',
    email_not_verified: 'Google에서 이메일 인증이 끝나지 않은 계정입니다.',
    google_access_denied: 'Google 로그인이 취소되었습니다.',
  };
  var q = new URLSearchParams(location.search);
  var el = document.getElementById('msg');
  var err = q.get('error');
  if (err) {
    el.textContent = MESSAGES[err] || '로그인에 실패했습니다 (' + err + '). 다시 시도하세요.';
    el.className = 'msg err';
    el.hidden = false;
  } else if (q.get('bye')) {
    el.textContent = '로그아웃되었습니다.';
    el.className = 'msg ok';
    el.hidden = false;
  }
})();
