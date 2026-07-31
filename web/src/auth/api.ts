export interface LoginResponse {
  token: string
}

export async function login(baseUrl: string, email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Invalid email or password' : `Login failed: ${response.status}`)
  }

  return response.json() as Promise<LoginResponse>
}
