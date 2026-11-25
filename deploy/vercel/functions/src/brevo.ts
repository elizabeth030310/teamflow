export function brevoMailer(environment: NodeJS.ProcessEnv, transport = fetch) {
  const apiKey = environment.TEAMFLOW_BREVO_API_KEY?.trim()
  const sender = (environment.TEAMFLOW_BREVO_FROM || environment.TEAMFLOW_SMTP_FROM)?.trim()
  if (!apiKey || !sender || (environment.TEAMFLOW_MAIL_PROVIDER ?? 'brevo') !== 'brevo') return null

  return async (email: string, code: string) => {
    const response = await transport('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender }, to: [{ email }], subject: 'TeamFlow 회원가입 인증번호',
        textContent: `인증번호는 ${code}입니다. 5분 안에 입력해 주세요. 가입을 요청하지 않았다면 이 메일을 무시하셔도 됩니다.`,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    await response.body?.cancel()
    if (response.status !== 201) throw new Error('Signup email delivery failed')
  }
}
